// Operation builders — Michelson / Temple side. The dApp's use of the pure SDK, signed by the connected Temple
// wallet (tezos.wallet.batch). Mirror of lib/opsEvm.ts (the MetaMask / EVM-native side); both produce the SAME
// BuyDetails / SwapDetails the review modals render.
//
//   SELLER   buildMintListOps  — mint N FA2 tokens + list each as an objkt ask (one op-group, auto-chunked)
//   BUYER    buildBuyBatch     — pay an ERC20 for an XTZ-priced ask (swap → fulfill), one atomic group
//   BRIDGE   buildSwapBatch    — swap any token → any token
//
// On the Temple side the EVM-runtime ops (approve / swap) run through the `call_evm` gateway AS the account's
// `evm alias` (a 0x derived from the tz1, holding the ERC20s); native-XTZ swap output auto-forwards back to the
// tz1 (`michelson account`); the objkt fulfill and FA2 ops are native Michelson, signed by the tz1.
import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind, TezosToolkit } from '@taquito/taquito';
import type { MichelsonV1Expression } from '@taquito/rpc';
import {
  XTZ,
  buildBatchTransaction,
  createMichelsonOpsBuilder,
  fromEvmUnits,
  isXtz,
  michelsonToEvmAlias,
  objkt,
  resolveApproval,
  targetForMinOut,
  toEvmUnits,
} from '@baking-bad/free-route-tezos-x';
import type { ApprovalMode, FreeRouteToken } from '@baking-bad/free-route-tezos-x';
import { CFG } from './config';
import { freeRoute } from './freeRoute';
import { fmtUnits, short } from './format';

const MAX_GAS_PER_BATCH = 2_500_000; // stay safely under the per-op-group ceiling; split if exceeded

// Michelson op builders with our network's call_evm gateway bound in — call .buildSwapOperation without repeating it.
const michelsonOps = createMichelsonOpsBuilder(CFG.gateway);

// One reviewed step. `kind` is the short op label (also the receipt tx-link label); `detail` is the
// `operation → TO` notation line shown in the modal (the sender lives in the modal's "Signed by" header).
export interface Step {
  kind: string;
  detail: string;
}

// ───────────────────────────── Michelson value builders ─────────────────────────────
const m = {
  string: (s: string): MichelsonV1Expression => ({ string: s }),
  int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }),
  pair: (...a: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args: a }),
  left: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Left', args: [x] }),
  right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as MichelsonV1Expression,
  none: { prim: 'None' } as MichelsonV1Expression,
};

// FA2 `update_operators` param adding `operator` for `(owner, token_id)` (Add_operator is the first variant).
const addOperatorValue = (owner: string, operator: string, tokenId: number): MichelsonV1Expression =>
  [m.left(m.pair(m.string(owner), m.string(operator), m.int(tokenId)))] as unknown as MichelsonV1Expression;

// objkt v4 `ask` parameter (XTZ currency, 1 edition, seller takes 100%).
const askValue = (fa2: string, tokenId: number, priceMutez: number, seller: string): MichelsonV1Expression =>
  m.pair(
    m.pair(m.string(fa2), m.int(tokenId)),
    m.right(m.right(m.unit)),
    m.int(priceMutez),
    m.int(1),
    [{ prim: 'Elt', args: [m.string(seller), m.int(1000)] }] as unknown as MichelsonV1Expression,
    m.none,
    m.none,
    m.int(0),
    m.none,
  );

// ───────────────────────────── step notation ─────────────────────────────
// approve step(s) for the chosen ApprovalMode. On the Temple side the approve runs via `call_evm` as the
// evm alias against the free-route router; `amount` is the exact allowance granted (consumer units).
const approveSteps = (approval: ApprovalMode, amount: bigint, token: FreeRouteToken): Step[] => {
  const approveExact: Step = { kind: 'approve', detail: `call_evm(${token.symbol}.approve(router, ${fmtUnits(amount, token.decimals, token.decimals)}))` };
  if (approval === 'resetThenApprove') return [{ kind: 'approve', detail: `call_evm(${token.symbol}.approve(router, 0))` }, approveExact];
  if (approval === 'approve') return [approveExact];
  return []; // 'none' — native XTZ input (carries msg.value), or the allowance already covers it
};

// Where a token sits on the Temple side: native XTZ on the tz1 (`michelson account`), ERC20s on the `evm alias`.
const holderOf = (token: FreeRouteToken) => (isXtz(token.address) ? 'michelson account' : 'evm alias');

// ───────────────────────────── SELLER: mint N tokens + list each as an ask ─────────────────────────────
export interface SellerItem {
  priceMutez: number;
}

// One ordered op list: [mint..., update_operators..., ask...]. The FA2 assigns ids from its next_token_id
// counter, so token ids are positional: the i-th mint gets `baseTokenId + i` (baseTokenId = next_token_id read
// just before sending). All mints precede the operator/ask ops so the tokens exist first and chunked sends stay
// valid. objkt pulls the NFT from the seller on fulfill, hence the per-token update_operators approving it.
// Note: ids are predicted from baseTokenId — if another account mints into the same FA2 between the read and
// these ops landing, the predictions shift and the asks reference the wrong tokens. Fine for a single-user demo;
// the on-chain counter is the real guard (ids never collide).
export function buildMintListOps(seller: string, items: SellerItem[], baseTokenId: number): ParamsWithKind[] {
  const tid = (i: number) => baseTokenId + i;
  const mints: ParamsWithKind[] = items.map(() => ({
    kind: OpKind.TRANSACTION,
    to: CFG.fa2,
    amount: 0,
    parameter: { entrypoint: 'mint', value: m.string(seller) },
    gasLimit: 200_000,
    storageLimit: 500,
    fee: 30_000,
  }));
  const operators: ParamsWithKind[] = items.map((_, i) => ({
    kind: OpKind.TRANSACTION,
    to: CFG.fa2,
    amount: 0,
    parameter: { entrypoint: 'update_operators', value: addOperatorValue(seller, CFG.objkt, tid(i)) },
    gasLimit: 200_000,
    storageLimit: 350,
    fee: 30_000,
  }));
  const asks: ParamsWithKind[] = items.map((it, i) => ({
    kind: OpKind.TRANSACTION,
    to: CFG.objkt,
    amount: 0,
    parameter: { entrypoint: 'ask', value: askValue(CFG.fa2, tid(i), it.priceMutez, seller) },
    gasLimit: 400_000,
    storageLimit: 1_200,
    fee: 40_000,
  }));
  return [...mints, ...operators, ...asks];
}

// ───────────────────────────── BUYER: pay an ERC20 for an XTZ-priced ask ─────────────────────────────
export interface BuyDetails {
  askId: string;
  tokenId: string;
  priceMutez: number;
  payToken: FreeRouteToken;
  payAmount: string; // swap.srcAmount, base units of payToken — the (max) input for the exact-out swap
  expectedOutMutez: number; // swap.dstAmount (mutez) — expected XTZ out
  minOutMutez: number; // swap.dstAmountMin (mutez) — guaranteed XTZ floor (== price after our sizing)
  changeMutez: number; // expectedOut - price, the surplus returned to the buyer (>= 0)
  slippageBps: number;
  router: string;
  steps: Step[];
}

export async function buildBuyBatch(
  buyerMichelsonAddress: string,
  ask: { askId: string; tokenId: string; priceMutez: number },
  payToken: FreeRouteToken,
  slippageBps: number,
  recipient?: string | null, // Michelson address the NFT goes to (objkt proxy_for); null/undefined = the buyer (tz1)
): Promise<{ ops: ParamsWithKind[]; details: BuyDetails }> {
  const buyerAlias = michelsonToEvmAlias(buyerMichelsonAddress); // the evm alias that holds the ERC20 + runs the swap

  // exact-out: size the XTZ out so the on-chain floor still covers the ask price
  // (targetForMinOut / getSwap enforce the 0..5000 bps contract, so no local clamp here)
  const minOutTarget = targetForMinOut(BigInt(ask.priceMutez), slippageBps);
  const swapAmount = toEvmUnits(minOutTarget, XTZ.address); // mutez -> wei for the EVM API
  const swap = await freeRoute.getSwap({
    src: payToken.address,
    dst: XTZ.address,
    amount: swapAmount,
    isExactOut: true,
    from: buyerAlias,
    receiver: buyerAlias,
    slippageBps,
  });
  const srcAmount = swap.srcAmount;

  // read the on-chain allowance -> pick the minimal safe approval mode (none / approve / reset+approve)
  const approval = await resolveApproval({
    evmRpc: CFG.evmRpc,
    token: payToken.address,
    owner: buyerAlias,
    spender: swap.tx.to,
    amount: srcAmount,
  });

  // approve(s) + swap, composed with the objkt fulfill (paid by the bridged XTZ) -> one atomic group
  const swapOps = michelsonOps.buildSwapOperation({ swap, srcAddress: payToken.address, approval });
  const fulfillOp = objkt.buildMichelsonFulfillAskOperation({
    marketplace: CFG.objkt,
    askId: ask.askId,
    editions: 1,
    amountMutez: ask.priceMutez,
    recipient,
  });
  const ops = buildBatchTransaction(swapOps, fulfillOp);

  const expectedOutMutez = Number(fromEvmUnits(swap.dstAmount, XTZ.address));
  const minOutMutez = Number(fromEvmUnits(swap.dstAmountMin, XTZ.address)); // == price after our sizing
  const nftTo = recipient ? short(recipient, 6) : 'your michelson account'; // where the NFT lands in the notation

  const details: BuyDetails = {
    askId: ask.askId,
    tokenId: ask.tokenId,
    priceMutez: ask.priceMutez,
    payToken,
    payAmount: srcAmount.toString(),
    expectedOutMutez,
    minOutMutez,
    changeMutez: Math.max(0, expectedOutMutez - ask.priceMutez),
    slippageBps,
    router: swap.tx.to,
    // mirrors the ACTUAL ops (2 / 3 / 4, by approval mode): approve(s) via call_evm, the swap (XTZ auto-forwards
    // to the tz1), then the native objkt fulfill that the bridged XTZ pays for.
    steps: [
      ...approveSteps(approval, srcAmount, payToken),
      { kind: 'swap', detail: 'call_evm(router.swap()) —XTZ→ your michelson account' },
      { kind: 'fulfill_ask', detail: `objkt.fulfill_ask() —NFT→ ${nftTo}` },
    ],
  };
  return { ops, details };
}

// ───────────────────────────── BRIDGE: swap any token -> any token ─────────────────────────────
export interface SwapDetails {
  src: FreeRouteToken;
  dst: FreeRouteToken;
  payAmount: bigint; // src consumer units actually spent (== input, since exact-input)
  expectedOut: bigint; // dst consumer units expected
  minOut: bigint; // dst consumer units guaranteed (floor)
  slippageBps: number;
  router: string;
  approval: ApprovalMode; // 'none' for native XTZ input, else allowance-aware
  steps: Step[]; // the atomic op-group, mirrors the review
}

// exact-input swap signed by the connected wallet. `amount` is src consumer units (mutez for XTZ, base for ERC20).
export async function buildSwapBatch(
  account: string,
  src: FreeRouteToken,
  dst: FreeRouteToken,
  amount: bigint,
  slippageBps: number,
  receiver?: string | null, // EVM 0x address the output lands on; null/undefined = the account's evm alias
): Promise<{ ops: ParamsWithKind[]; details: SwapDetails }> {
  const accountAlias = michelsonToEvmAlias(account); // the evm alias that runs the swap
  const out = receiver ?? accountAlias;

  // exact-in: any token -> any token (XTZ <-> ERC20, ERC20 <-> ERC20)
  const swapAmount = toEvmUnits(amount, src.address); // to wei for the EVM API
  const swap = await freeRoute.getSwap({
    src: src.address,
    dst: dst.address,
    amount: swapAmount,
    isExactOut: false,
    from: accountAlias,
    receiver: out,
    slippageBps,
  });

  // native XTZ carries value as msg.value (no approve); an ERC20 picks the minimal safe mode (none / approve / reset+approve)
  const approval: ApprovalMode = isXtz(src.address)
    ? 'none'
    : await resolveApproval({ evmRpc: CFG.evmRpc, token: src.address, owner: accountAlias, spender: swap.tx.to, amount: swap.srcAmount });

  // approve(s) + swap -> one atomic group; native-XTZ output auto-forwards to the tz1
  const swapOps = michelsonOps.buildSwapOperation({ swap, srcAddress: src.address, approval });
  const payAmount = fromEvmUnits(swap.srcAmount, src.address);

  return {
    ops: swapOps,
    details: {
      src,
      dst,
      payAmount,
      expectedOut: fromEvmUnits(swap.dstAmount, dst.address),
      minOut: fromEvmUnits(swap.dstAmountMin, dst.address),
      slippageBps,
      router: swap.tx.to,
      approval,
      // mirrors the ACTUAL ops (1 / 2 / 3, by approval mode); the swap output lands on the dst token's holder.
      steps: [...approveSteps(approval, payAmount, src), { kind: 'swap', detail: `call_evm(router.swap()) —${dst.symbol}→ ${receiver ? short(receiver, 6) : `your ${holderOf(dst)}`}` }],
    },
  };
}

// ───────────────────────────── send ─────────────────────────────
// Send a prepared op group as ONE atomic wallet batch (the buy must stay atomic — never chunked).
export async function sendWalletGroup(tezos: TezosToolkit, ops: ParamsWithKind[]): Promise<string> {
  const op = await tezos.wallet.batch().with(ops as never).send();
  await op.confirmation();
  return op.opHash;
}

// Send a (potentially large) op list, greedily chunked under the gas ceiling, via the wallet.
export async function sendChunked(
  tezos: TezosToolkit,
  ops: ParamsWithKind[],
  onHash?: (hash: string, idx: number, total: number) => void,
): Promise<string[]> {
  // greedy pack preserving order
  const batches: ParamsWithKind[][] = [];
  let cur: ParamsWithKind[] = [];
  let gas = 0;
  for (const op of ops) {
    const g = (op as { gasLimit?: number }).gasLimit ?? 0;
    if (cur.length && gas + g > MAX_GAS_PER_BATCH) {
      batches.push(cur);
      cur = [];
      gas = 0;
    }
    cur.push(op);
    gas += g;
  }
  if (cur.length) batches.push(cur);

  const hashes: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    const op = await tezos.wallet.batch().with(batches[i] as never).send();
    hashes.push(op.opHash);
    onHash?.(op.opHash, i + 1, batches.length);
    await op.confirmation();
  }
  return hashes;
}
