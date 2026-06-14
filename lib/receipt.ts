// Post-buy reconciliation — Michelson side only, EXACT measured data (no estimates/fudging).
// Reads the buyer's real balances (before/after) and the operation group. Everything is measured:
//   - usdcSpent / xtzNet  — wallet balance deltas (Michelson XTZ, alias pay-token).
//   - networkFee          — Σ bakerFee+storageFee+allocationFee over the group (tzkt nets the previewnet
//                           fee-refund across ops; the SUM is the actual paid fee).
//   - actualChange = xtzNet + networkFee — the real swap surplus left on the Michelson address (both terms measured ⇒ exact).
//   - fulfillAmount       — XTZ the buyer sent to objkt via fulfill_ask (the op value).
//   - nftOwned            — FA2 ledger now shows the buyer as the token owner (real on-chain check).
import { CFG } from './config';
import { isXtz } from './sdk';
import type { ThreeRouteToken } from './sdk';
import { fetchErc20Balance, fetchOwner, fetchXtzBalance } from './tzkt';

export interface BuyReceipt {
  opHash: string;
  // measured — wallet
  xtzBefore: bigint; // Michelson XTZ (mutez)
  xtzAfter: bigint;
  usdcBefore: bigint; // alias pay-token (base units)
  usdcAfter: bigint;
  usdcSpent: bigint; // usdcBefore − usdcAfter (== swap input)
  xtzNet: bigint; // xtzAfter − xtzBefore (signed, ground truth)
  // network fee (measured, exact) + change
  networkFee: bigint; // actual paid fee = Σ (bakerFee + storageFee + allocationFee) over the op group
  expectedChange: bigint; // BuyDetails.changeMutez — change the quote expected (exact-out buffer)
  actualChange: bigint; // = xtzNet + networkFee — real swap surplus left on the Michelson address (exact: both terms measured)
  // measured — op group
  fulfillAmount: bigint; // XTZ the buyer sent to objkt via fulfill_ask
  // checks (real, on-chain)
  paidAsQuoted: boolean; // usdcSpent === quoted srcAmount
  changeWithinExpected: boolean; // actualChange <= expectedChange (didn't over-fund beyond the quote)
  nftOwned: boolean; // FA2 ledger: token now owned by the buyer
}

interface OpItem {
  amount?: number;
  parameter?: { entrypoint: string } | null;
  bakerFee?: number; // tzkt reports the group's actual (refunded) fee here; can be negative on one op
  storageFee?: number;
  allocationFee?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// tzkt lags the node by a few seconds — poll until the group is indexed (`ready` confirms the key op is present).
async function fetchOpGroup(opHash: string, ready: (items: OpItem[]) => boolean, tries = 8, delayMs = 1500): Promise<OpItem[]> {
  for (let i = 0; i < tries; i++) {
    const items = (await fetch(`${CFG.tzktApi}/operations/${opHash}`).then((r) => r.json()).catch(() => [])) as OpItem[];
    if (Array.isArray(items) && ready(items)) return items;
    await sleep(delayMs);
  }
  throw new Error('operation not indexed yet');
}

export async function buildBuyReceipt(params: {
  opHash: string;
  buyer: string; // Michelson address
  aliasAddress: string;
  payTokenAddress: string;
  tokenId: string; // FA2 token id, for the ownership check
  quotedSrcAmount: bigint; // BuyDetails.payAmount
  expectedChange: bigint; // BuyDetails.changeMutez
  before: { xtz: bigint; usdc: bigint };
}): Promise<BuyReceipt> {
  const items = await fetchOpGroup(params.opHash, (o) => o.some((x) => x.parameter?.entrypoint === 'fulfill_ask'));

  // value the buyer sent to the marketplace (fulfill_ask carries the XTZ price).
  const fulfillAmount = BigInt(items.find((o) => o.parameter?.entrypoint === 'fulfill_ask')?.amount ?? 0);

  // actual paid fee — tzkt nets the previewnet fee-refund across the group; the SUM is the real fee.
  const networkFee = items.reduce((s, o) => s + BigInt(o.bakerFee ?? 0) + BigInt(o.storageFee ?? 0) + BigInt(o.allocationFee ?? 0), 0n);

  // live balances AFTER (node head — immediate, no indexer lag)
  const [xtzAfter, usdcAfter] = await Promise.all([
    fetchXtzBalance(params.buyer),
    fetchErc20Balance(params.payTokenAddress, params.aliasAddress),
  ]);
  const usdcSpent = params.before.usdc - usdcAfter;
  const xtzNet = xtzAfter - params.before.xtz;

  // ownership — poll the FA2 ledger (indexer lag) until the buyer shows as owner.
  let owner: string | null = null;
  for (let i = 0; i < 5; i++) {
    owner = await fetchOwner(params.tokenId);
    if (owner === params.buyer) break;
    await sleep(1500);
  }

  return {
    opHash: params.opHash,
    xtzBefore: params.before.xtz,
    xtzAfter,
    usdcBefore: params.before.usdc,
    usdcAfter,
    usdcSpent,
    xtzNet,
    networkFee,
    expectedChange: params.expectedChange,
    actualChange: xtzNet + networkFee, // real swap surplus that stayed on the Michelson address (exact)
    fulfillAmount,
    paidAsQuoted: usdcSpent === params.quotedSrcAmount,
    changeWithinExpected: xtzNet + networkFee <= params.expectedChange,
    nftOwned: owner === params.buyer,
  };
}

// ---------------- BRIDGE: post-swap reconciliation (any token -> any token), EXACT measured data ----------------
// XTZ lives on the tz1 account (and pays the op fee); ERC20s live on the alias. We isolate the swap amount by
// adding the measured fee back on whichever side is native XTZ.
export interface SwapReceipt {
  opHash: string;
  src: ThreeRouteToken;
  dst: ThreeRouteToken;
  srcSpent: bigint; // src consumer units actually spent
  dstReceived: bigint; // dst consumer units actually received
  networkFee: bigint; // mutez, Σ (bakerFee + storageFee + allocationFee)
  srcBefore: bigint; // relevant src-token balance (consumer units) before/after
  srcAfter: bigint;
  dstBefore: bigint;
  dstAfter: bigint;
  quotedPay: bigint; // SwapDetails.payAmount
  minOut: bigint; // SwapDetails.minOut
  paidAsQuoted: boolean; // srcSpent === quotedPay
  receivedAtLeastMin: boolean; // dstReceived >= minOut
}

export async function buildSwapReceipt(params: {
  opHash: string;
  account: string; // Michelson address (tz1)
  aliasAddress: string;
  src: ThreeRouteToken;
  dst: ThreeRouteToken;
  quotedPay: bigint;
  minOut: bigint;
  before: { xtz: bigint; src: bigint; dst: bigint }; // src/dst = that token's balance at snapshot (consumer units)
}): Promise<SwapReceipt> {
  const items = await fetchOpGroup(params.opHash, (o) => o.some((x) => x.parameter?.entrypoint === 'call_evm'));
  const networkFee = items.reduce((s, o) => s + BigInt(o.bakerFee ?? 0) + BigInt(o.storageFee ?? 0) + BigInt(o.allocationFee ?? 0), 0n);

  const srcXtz = isXtz(params.src.address);
  const dstXtz = isXtz(params.dst.address);
  const [xtzAfter, ercSrcAfter, ercDstAfter] = await Promise.all([
    fetchXtzBalance(params.account),
    srcXtz ? Promise.resolve(0n) : fetchErc20Balance(params.src.address, params.aliasAddress),
    dstXtz ? Promise.resolve(0n) : fetchErc20Balance(params.dst.address, params.aliasAddress),
  ]);

  const srcAfter = srcXtz ? xtzAfter : ercSrcAfter;
  const dstAfter = dstXtz ? xtzAfter : ercDstAfter;
  const srcSpent = srcXtz ? params.before.xtz - xtzAfter - networkFee : params.before.src - srcAfter;
  const dstReceived = dstXtz ? xtzAfter - params.before.xtz + networkFee : dstAfter - params.before.dst;

  return {
    opHash: params.opHash,
    src: params.src,
    dst: params.dst,
    srcSpent,
    dstReceived,
    networkFee,
    srcBefore: params.before.src,
    srcAfter,
    dstBefore: params.before.dst,
    dstAfter,
    quotedPay: params.quotedPay,
    minOut: params.minOut,
    paidAsQuoted: srcSpent === params.quotedPay,
    receivedAtLeastMin: dstReceived >= params.minOut,
  };
}
