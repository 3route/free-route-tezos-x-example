// Post-buy reconciliation — Michelson side only, EXACT measured data (no estimates/fudging).
// Reads the buyer's real balances (before/after) and the operation group. Everything is measured:
//   - usdcSpent / xtzNet  — wallet balance deltas (Michelson XTZ, alias pay-token).
//   - networkFee          — Σ bakerFee+storageFee+allocationFee over the group (tzkt nets the previewnet
//                           fee-refund across ops; the SUM is the actual paid fee).
//   - actualChange = xtzNet + networkFee — the real swap surplus left on the Michelson address (both terms measured ⇒ exact).
//   - fulfillAmount       — XTZ the buyer sent to objkt via fulfill_ask (the op value).
//   - nftOwned            — FA2 ledger now shows the buyer as the token owner (real on-chain check).
import { CFG } from './config';
import { XTZ, fromEvmUnits, isXtz } from '@baking-bad/free-route-tezos-x';
import type { FreeRouteToken } from '@baking-bad/free-route-tezos-x';
import { fetchErc20Balance, fetchEvmTxFeeWei, fetchEvmXtzBalanceWei, fetchOwner, fetchXtzBalance } from './tzkt';

// wei -> mutez, converting the COMBINED delta once. Flooring each balance/fee to mutez separately and then
// subtracting would leak ±1-2 mutez of sub-mutez dust into the isolated swap amount (a phantom "overpaid" red).
const weiToMutez = (wei: bigint) => fromEvmUnits(wei, XTZ.address);

// Label the receipt's tx links. Sequential / non-atomic batch → one hash per op, so labels align 1:1. An atomic
// EIP-5792 batch collapses to a single tx hash → label it "atomic batch". Anything else falls back to "tx N".
const labelEvmTxs = (hashes: string[], stepLabels: string[]): { label: string; hash: string }[] => {
  if (hashes.length === stepLabels.length) return hashes.map((hash, i) => ({ label: stepLabels[i], hash }));
  if (hashes.length === 1) return [{ label: 'atomic batch', hash: hashes[0] }];
  return hashes.map((hash, i) => ({ label: `tx ${i + 1}`, hash }));
};

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
  nftOwned: boolean; // FA2 ledger: token now owned by the expected recipient (buyer by default)
  recipient?: string; // set only when the NFT was directed elsewhere (objkt proxy_for) — for the receipt's owner line
  evm?: boolean; // true = MetaMask path (opHash is an EVM tx; link to blockscout). Default false = Michelson op (tzkt).
  txs?: { label: string; hash: string }[]; // EVM sequential path: every tx (approve / swap / fulfill) with its step label
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
  recipient?: string | null; // where the NFT was directed (objkt proxy_for); null = the buyer
  before: { xtz: bigint; usdc: bigint };
}): Promise<BuyReceipt> {
  const items = await fetchOpGroup(params.opHash, (o) => o.some((x) => x.parameter?.entrypoint === 'fulfill_ask'));
  const nftOwner = params.recipient ?? params.buyer; // who should own the NFT after the buy

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

  // ownership — poll the FA2 ledger (indexer lag) until the recipient shows as owner.
  let owner: string | null = null;
  for (let i = 0; i < 5; i++) {
    owner = await fetchOwner(params.tokenId);
    if (owner === nftOwner) break;
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
    nftOwned: owner === nftOwner,
    recipient: params.recipient ?? undefined,
  };
}

// EVM (MetaMask) variant of the buy receipt — same measured fields, read from the EVM side: the pay-token + native
// XTZ on the 0x account, fee = Σ gasUsed×gasPrice. The NFT lands on the account's KT1 alias (Michelson), so the
// ownership check polls the FA2 ledger for that alias. opHash = the fulfill tx (linked to blockscout).
export async function buildEvmBuyReceipt(params: {
  hashes: string[];
  stepLabels: string[]; // per-tx step kind (approve / swap / fulfill_ask), parallel to hashes
  account: string; // the 0x account (pays the pay-token + native XTZ)
  nftAlias: string; // the account's KT1 Michelson alias (where the NFT lands)
  payTokenAddress: string;
  tokenId: string;
  quotedSrcAmount: bigint; // BuyDetails.payAmount
  expectedChange: bigint; // BuyDetails.changeMutez
  fulfillMutez: bigint; // XTZ sent to objkt (the ask price)
  recipient?: string | null; // where the NFT was directed (objkt proxy_for); null = the account's KT1 alias
  before: { xtz: bigint; usdc: bigint }; // EVM-account native XTZ in WEI + pay-token (base units)
}): Promise<BuyReceipt> {
  const nftOwner = params.recipient ?? params.nftAlias; // who should own the NFT after the buy
  const [xtzAfterWei, usdcAfter, feeWei] = await Promise.all([
    fetchEvmXtzBalanceWei(params.account),
    fetchErc20Balance(params.payTokenAddress, params.account),
    fetchEvmTxFeeWei(params.hashes),
  ]);
  const usdcSpent = params.before.usdc - usdcAfter;
  // native-XTZ side in wei, converted once (see weiToMutez) so sub-mutez gas dust doesn't skew change/net XTZ
  const networkFee = weiToMutez(feeWei);
  const xtzBefore = weiToMutez(params.before.xtz);
  const xtzAfter = weiToMutez(xtzAfterWei);
  const xtzNet = weiToMutez(xtzAfterWei - params.before.xtz);
  const actualChange = weiToMutez(xtzAfterWei - params.before.xtz + feeWei); // = xtzNet + fee, isolated in wei

  // ownership — the NFT lands on the recipient (KT1 alias by default); poll the FA2 ledger until it shows.
  let owner: string | null = null;
  for (let i = 0; i < 5; i++) {
    owner = await fetchOwner(params.tokenId);
    if (owner === nftOwner) break;
    await sleep(1500);
  }

  return {
    opHash: params.hashes[params.hashes.length - 1],
    xtzBefore,
    xtzAfter,
    usdcBefore: params.before.usdc,
    usdcAfter,
    usdcSpent,
    xtzNet,
    networkFee,
    expectedChange: params.expectedChange,
    actualChange, // swap surplus left on the EVM account (isolated in wei, converted once)
    fulfillAmount: params.fulfillMutez,
    paidAsQuoted: usdcSpent === params.quotedSrcAmount,
    changeWithinExpected: actualChange <= params.expectedChange,
    nftOwned: owner === nftOwner,
    recipient: params.recipient ?? undefined,
    evm: true,
    txs: labelEvmTxs(params.hashes, params.stepLabels),
  };
}

// ---------------- BRIDGE: post-swap reconciliation (any token -> any token), EXACT measured data ----------------
// XTZ lives on the tz1 account (and pays the op fee); ERC20s live on the alias. We isolate the swap amount by
// adding the measured fee back on whichever side is native XTZ.
export interface SwapReceipt {
  opHash: string;
  src: FreeRouteToken;
  dst: FreeRouteToken;
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
  evm?: boolean; // true = MetaMask path (opHash is an EVM tx; link to blockscout). Default false = Michelson op (tzkt).
  txs?: { label: string; hash: string }[]; // EVM sequential path: every tx (approve / swap / …) with its step label
  recipient?: string; // when set, the output was directed to this 0x address instead of the signer's own holder
}

export async function buildSwapReceipt(params: {
  opHash: string;
  account: string; // Michelson address (tz1)
  aliasAddress: string;
  src: FreeRouteToken;
  dst: FreeRouteToken;
  quotedPay: bigint;
  minOut: bigint;
  before: { xtz: bigint; src: bigint; dst: bigint }; // src/dst = that token's balance at snapshot (consumer units)
  dstReceiver?: { address: string; before: bigint } | null; // when set, dst landed on this 0x (EVM side), not the alias
}): Promise<SwapReceipt> {
  const items = await fetchOpGroup(params.opHash, (o) => o.some((x) => x.parameter?.entrypoint === 'call_evm'));
  const networkFee = items.reduce((s, o) => s + BigInt(o.bakerFee ?? 0) + BigInt(o.storageFee ?? 0) + BigInt(o.allocationFee ?? 0), 0n);

  const srcXtz = isXtz(params.src.address);
  const dstXtz = isXtz(params.dst.address);
  const recv = params.dstReceiver;
  const [xtzAfter, ercSrcAfter, ercDstAfter, recvDstAfter] = await Promise.all([
    fetchXtzBalance(params.account),
    srcXtz ? Promise.resolve(0n) : fetchErc20Balance(params.src.address, params.aliasAddress),
    dstXtz ? Promise.resolve(0n) : fetchErc20Balance(params.dst.address, params.aliasAddress),
    recv ? (dstXtz ? fetchEvmXtzBalanceWei(recv.address) : fetchErc20Balance(params.dst.address, recv.address)) : Promise.resolve(0n),
  ]);

  const srcAfter = srcXtz ? xtzAfter : ercSrcAfter;
  const srcSpent = srcXtz ? params.before.xtz - xtzAfter - networkFee : params.before.src - srcAfter;

  // dst is measured wherever it landed: a custom 0x receiver (EVM side, no gas to add back) or the signer's holder.
  // for XTZ subtract in WEI then convert once (floor-then-subtract leaks ±1 mutez — same bug as the buy receipt).
  const dstBefore = recv ? (dstXtz ? weiToMutez(recv.before) : recv.before) : params.before.dst;
  const dstAfter = recv ? (dstXtz ? weiToMutez(recvDstAfter) : recvDstAfter) : dstXtz ? xtzAfter : ercDstAfter;
  const dstReceived = recv
    ? dstXtz
      ? weiToMutez(recvDstAfter - recv.before)
      : recvDstAfter - recv.before
    : dstXtz
      ? xtzAfter - params.before.xtz + networkFee
      : dstAfter - params.before.dst;

  return {
    opHash: params.opHash,
    src: params.src,
    dst: params.dst,
    srcSpent,
    dstReceived,
    networkFee,
    srcBefore: params.before.src,
    srcAfter,
    dstBefore,
    dstAfter,
    quotedPay: params.quotedPay,
    minOut: params.minOut,
    paidAsQuoted: srcSpent === params.quotedPay,
    receivedAtLeastMin: dstReceived >= params.minOut,
    recipient: recv?.address,
  };
}

// EVM (MetaMask) variant of the swap receipt — same measured fields, read from the EVM side: native XTZ via
// eth_getBalance (the account also pays gas in XTZ, added back to isolate the swap), ERC20s via balanceOf, and
// the fee = Σ gasUsed×gasPrice over the sent txs. opHash = the final tx (the swap), linked to blockscout.
export async function buildEvmSwapReceipt(params: {
  hashes: string[];
  stepLabels: string[]; // per-tx step kind (approve / swap / …), parallel to hashes
  account: string; // the 0x account (holds ERC20s + native XTZ)
  src: FreeRouteToken;
  dst: FreeRouteToken;
  quotedPay: bigint;
  minOut: bigint;
  before: { native: bigint; src: bigint; dst: bigint }; // native in WEI; src/dst = that token's balance (0 if XTZ)
  dstReceiver?: { address: string; before: bigint } | null; // when set, dst landed on this 0x, not the account
}): Promise<SwapReceipt> {
  const srcXtz = isXtz(params.src.address);
  const dstXtz = isXtz(params.dst.address);
  const recv = params.dstReceiver;
  const [nativeAfterWei, ercSrcAfter, ercDstAfter, feeWei, recvDstAfter] = await Promise.all([
    fetchEvmXtzBalanceWei(params.account),
    srcXtz ? Promise.resolve(0n) : fetchErc20Balance(params.src.address, params.account),
    dstXtz ? Promise.resolve(0n) : fetchErc20Balance(params.dst.address, params.account),
    fetchEvmTxFeeWei(params.hashes),
    recv ? (dstXtz ? fetchEvmXtzBalanceWei(recv.address) : fetchErc20Balance(params.dst.address, recv.address)) : Promise.resolve(0n),
  ]);
  const networkFee = weiToMutez(feeWei);

  // The native-XTZ side is computed in wei and converted once (see weiToMutez) — the account pays gas in XTZ, so
  // we add the fee back to isolate the swap amount. ERC20 sides are already exact base units (no wei flooring).
  const srcBefore = srcXtz ? weiToMutez(params.before.native) : params.before.src;
  const srcAfter = srcXtz ? weiToMutez(nativeAfterWei) : ercSrcAfter;
  const srcSpent = srcXtz ? weiToMutez(params.before.native - nativeAfterWei - feeWei) : params.before.src - ercSrcAfter;

  // dst is measured wherever it landed: a custom 0x receiver (pays no gas → no fee add-back) or the account itself.
  // for XTZ subtract in WEI then convert once (floor-then-subtract leaks ±1 mutez — same bug as the buy receipt).
  const dstBefore = recv ? (dstXtz ? weiToMutez(recv.before) : recv.before) : dstXtz ? weiToMutez(params.before.native) : params.before.dst;
  const dstAfter = recv ? (dstXtz ? weiToMutez(recvDstAfter) : recvDstAfter) : dstXtz ? weiToMutez(nativeAfterWei) : ercDstAfter;
  const dstReceived = recv
    ? dstXtz
      ? weiToMutez(recvDstAfter - recv.before)
      : recvDstAfter - recv.before
    : dstXtz
      ? weiToMutez(nativeAfterWei - params.before.native + feeWei)
      : ercDstAfter - params.before.dst;

  return {
    opHash: params.hashes[params.hashes.length - 1],
    src: params.src,
    dst: params.dst,
    srcSpent,
    dstReceived,
    networkFee,
    srcBefore,
    srcAfter,
    dstBefore,
    dstAfter,
    quotedPay: params.quotedPay,
    minOut: params.minOut,
    paidAsQuoted: srcSpent === params.quotedPay,
    receivedAtLeastMin: dstReceived >= params.minOut,
    evm: true,
    txs: labelEvmTxs(params.hashes, params.stepLabels),
    recipient: recv?.address,
  };
}

// ---------------- SELLER: mint+list record (no reconciliation — just the op hashes + what was listed) ----------------
export interface MintReceiptItem {
  tokenId: number;
  name: string;
  priceMutez: number;
}

export interface MintReceipt {
  hashes: string[]; // Temple: one per chunked op-group · MetaMask: one per callMichelson tx (mint / approve / list)
  items: MintReceiptItem[];
  evm?: boolean; // true = MetaMask path (hashes are EVM txs → blockscout). Default false = Michelson ops (tzkt).
  txLabels?: string[]; // EVM: per-tx step label (mint #id / approve objkt #id / list #id), parallel to hashes
}
