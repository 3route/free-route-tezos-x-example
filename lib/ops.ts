// Operation builders — the dApp's use of the pure-SDK. Mirrors sdk/index.ts (buy) and scripts/setup.ts
// (mint+list), but signed by the connected Temple wallet (tezos.wallet.batch).
import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind, TezosToolkit } from '@taquito/taquito';
import type { MichelsonV1Expression } from '@taquito/rpc';
import { CFG } from './config';
import { XTZ, buildBatchTransaction, buildSwapOperation, fromEvm, isXtz, michelsonToEvmAlias, objkt, resolveApproval, targetForMinOut, freeRoute, toEvm } from './sdk';
import type { ApprovalMode, FreeRouteToken } from './sdk';
import { fmtUnits } from './format';

const MAX_GAS_PER_BATCH = 2_500_000; // stay safely under the per-op-group ceiling; split if exceeded

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

// ---------------- SELLER: mint N tokens + list each as an ask ----------------
export interface SellerItem {
  priceMutez: number;
}

// One ordered op list: [mint..., update_operators..., ask...]. The FA2 assigns ids from its
// next_token_id counter, so token ids are positional: the i-th mint gets `baseTokenId + i`
// (baseTokenId = next_token_id read just before sending). All mints precede the operator/ask ops
// so the tokens exist first and chunked sends stay valid. objkt pulls the NFT from the seller on
// fulfill, hence the per-token update_operators approving the marketplace.
// Note: ids are predicted from baseTokenId — if another account mints into the same FA2 between the
// read and these ops landing, the predictions shift and the asks would reference the wrong tokens.
// Fine for a single-user demo; the real guard is the on-chain counter (ids never collide).
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

// ---------------- BUYER: pay an ERC20 for an XTZ-priced ask ----------------
export interface BuyDetails {
  askId: string;
  tokenId: string;
  priceMutez: number;
  payToken: FreeRouteToken;
  payAmount: string; // swap.src.amount, base units of payToken — STRICT (calldata is exact-input)
  expectedOutMutez: number; // swap.dst.expected (mutez) — expected XTZ out
  minOutMutez: number; // swap.dst.min (mutez) — guaranteed XTZ floor (== price after our sizing)
  changeMutez: number; // expectedOut - price, returned to the buyer's Michelson address (>= 0)
  slippageBps: number;
  router: string;
  steps: Array<{ kind: string; detail: string }>;
}

export async function buildBuyBatch(
  buyerMichelsonAddress: string,
  ask: { askId: string; tokenId: string; priceMutez: number },
  payToken: FreeRouteToken,
  slippageBps: number,
): Promise<{ ops: ParamsWithKind[]; details: BuyDetails }> {
  const buyerAlias = michelsonToEvmAlias(buyerMichelsonAddress); // EVM identity holding the ERC20

  // exact-out: size the XTZ out so the on-chain floor still covers the ask price
  // (targetForMinOut / getSwap enforce the 0..5000 bps contract, so no local clamp here)
  const minOutTarget = targetForMinOut(BigInt(ask.priceMutez), slippageBps);
  const swap = await freeRoute.getSwap({
    src: payToken.address,
    dst: XTZ.address,
    amount: toEvm(minOutTarget, XTZ.address),
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
  const swapOps = buildSwapOperation({ swap, gateway: CFG.gateway, srcAddress: payToken.address, approval });
  const fulfillOp = objkt.buildFulfillAsk({ marketplace: CFG.objkt, askId: ask.askId, editions: 1, amountMutez: ask.priceMutez });
  const ops = buildBatchTransaction(swapOps, fulfillOp);

  const expectedOutMutez = Number(fromEvm(swap.dstAmount, XTZ.address));
  const minOutMutez = Number(fromEvm(swap.dstAmountMin, XTZ.address)); // == price after our sizing
  const changeMutez = Math.max(0, expectedOutMutez - ask.priceMutez);

  // steps mirror the ACTUAL ops (2 / 3 / 4 in the group, depending on the approval mode).
  const approveExact = { kind: 'approve (call_evm)', detail: `approve exactly ${fmtUnits(srcAmount, payToken.decimals, payToken.decimals)} ${payToken.symbol} to the free-route router` };
  const approveSteps =
    approval === 'resetThenApprove'
      ? [{ kind: 'approve (call_evm)', detail: `reset ${payToken.symbol} allowance to 0 (safe re-approval)` }, approveExact]
      : approval === 'approve'
        ? [approveExact]
        : []; // 'none' — allowance already covers it

  const details: BuyDetails = {
    askId: ask.askId,
    tokenId: ask.tokenId,
    priceMutez: ask.priceMutez,
    payToken,
    payAmount: srcAmount.toString(),
    expectedOutMutez,
    minOutMutez,
    changeMutez,
    slippageBps,
    router: swap.tx.to,
    steps: [
      ...approveSteps,
      { kind: 'swap (call_evm)', detail: `${payToken.symbol} → native XTZ to your alias → auto-forwards to your Michelson address` },
      { kind: 'fulfill_ask', detail: `buy ask#${ask.askId}, pay ${ask.priceMutez / 1e6} XTZ` },
    ],
  };
  return { ops, details };
}

// ---------------- BRIDGE: swap any token -> any token (XTZ <-> ERC20, ERC20 <-> ERC20) ----------------
export interface SwapDetails {
  src: FreeRouteToken;
  dst: FreeRouteToken;
  payAmount: bigint; // src consumer units actually spent (== input, since exact-input)
  expectedOut: bigint; // dst consumer units expected
  minOut: bigint; // dst consumer units guaranteed (floor)
  slippageBps: number;
  router: string;
  approval: ApprovalMode; // 'none' for native XTZ input, else allowance-aware
  steps: Array<{ kind: string; detail: string }>; // the atomic op-group, mirrors the review
}

// exact-input swap signed by the connected wallet. `amount` is src consumer units (mutez for XTZ, base for ERC20).
export async function buildSwapBatch(
  account: string,
  src: FreeRouteToken,
  dst: FreeRouteToken,
  amount: bigint,
  slippageBps: number,
): Promise<{ ops: ParamsWithKind[]; details: SwapDetails }> {
  const alias = michelsonToEvmAlias(account); // EVM identity that runs the swap

  // exact-in: any token -> any token (XTZ <-> ERC20, ERC20 <-> ERC20)
  const swap = await freeRoute.getSwap({
    src: src.address,
    dst: dst.address,
    amount: toEvm(amount, src.address),
    isExactOut: false,
    from: alias,
    receiver: alias,
    slippageBps,
  });

  // native XTZ carries value as msg.value (no approve); an ERC20 picks the minimal safe mode (none / approve / reset+approve)
  const approval: ApprovalMode = isXtz(src.address)
    ? 'none'
    : await resolveApproval({
        evmRpc: CFG.evmRpc,
        token: src.address,
        owner: alias,
        spender: swap.tx.to,
        amount: swap.srcAmount,
      });

  // approve(s) + swap -> one atomic group; native-XTZ output auto-forwards to your Michelson address
  const ops = buildSwapOperation({ swap, gateway: CFG.gateway, srcAddress: src.address, approval });
  const payAmount = fromEvm(swap.srcAmount, src.address);

  // steps mirror the ACTUAL ops (1 / 2 / 3, depending on the approval mode).
  const approveExact = { kind: 'approve (call_evm)', detail: `approve exactly ${fmtUnits(payAmount, src.decimals, src.decimals)} ${src.symbol} to the free-route router` };
  const approveSteps =
    approval === 'resetThenApprove'
      ? [{ kind: 'approve (call_evm)', detail: `reset ${src.symbol} allowance to 0 (safe re-approval)` }, approveExact]
      : approval === 'approve'
        ? [approveExact]
        : []; // 'none' — native XTZ input (carries msg.value), or allowance already covers it
  const landing = isXtz(dst.address) ? 'auto-forwards to your Michelson address' : 'received on your EVM alias';

  return {
    ops,
    details: {
      src,
      dst,
      payAmount,
      expectedOut: fromEvm(swap.dstAmount, dst.address),
      minOut: fromEvm(swap.dstAmountMin, dst.address),
      slippageBps,
      router: swap.tx.to,
      approval,
      steps: [...approveSteps, { kind: 'swap (call_evm)', detail: `${src.symbol} → ${dst.symbol} · ${landing}` }],
    },
  };
}

// Send a prepared op group as ONE atomic wallet batch (the buy must stay atomic — never chunked).
export async function sendWalletGroup(tezos: TezosToolkit, ops: ParamsWithKind[]): Promise<string> {
  const op = await tezos.wallet.batch().with(ops as never).send();
  await op.confirmation();
  return op.opHash;
}

// ---------------- send (chunked under the gas ceiling), via the wallet ----------------
export async function sendChunked(tezos: TezosToolkit, ops: ParamsWithKind[], onHash?: (hash: string, idx: number, total: number) => void): Promise<string[]> {
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
