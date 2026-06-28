// Operation builders — EVM-native / MetaMask side. Mirror of lib/opsMichelson.ts (Michelson / Temple). Every call is a
// native EVM tx: approve + swap (the raw /swap tx) + fulfill via the gateway's `callMichelson`. Returns
// EvmTxRequest[] for the connected EVM wallet to send (lib/evmWallet.sendCalls), plus the SAME BuyDetails /
// SwapDetails the review modals render. Mirrors scripts/evm/example-buy.ts + bridge.ts (verified on-chain).
//
//   BUYER    buildEvmBuyBatch      — pay an ERC20 for an XTZ-priced ask; the NFT lands on the michelson alias
//   BRIDGE   buildEvmSwapBatch     — swap any token → any token, all on the evm account
//   SELLER   buildEvmMintListBatch — mint + list NFTs, each Michelson op wrapped in callMichelson
//
// On the MetaMask side approve/swap are plain EVM txs on the `evm account` (no gateway); to reach a Michelson
// contract (objkt fulfill, FA2 mint/ask) we wrap it in `callMichelson`, where msg.sender becomes the account's
// `michelson alias` (a KT1) — so minted/bought NFTs land on that alias.
import {
  EVM_GATEWAY,
  XTZ,
  buildCallMichelsonTransaction,
  buildEvmSwapTransaction,
  forgeMichelson,
  fromEvmUnits,
  isXtz,
  objkt,
  resolveApproval,
  targetForMinOut,
  toEvmUnits,
} from '@baking-bad/free-route-tezos-x';
import type { ApprovalMode, EvmTxRequest, FreeRouteToken } from '@baking-bad/free-route-tezos-x';
import { CFG } from './config';
import { freeRoute } from './freeRoute';
import { fmtUnits } from './format';
import type { BuyDetails, SellerItem, Step, SwapDetails } from './opsMichelson';

// approve step(s) for the chosen ApprovalMode, as native EVM txs on the evm account (no gateway).
const approveSteps = (approval: ApprovalMode, amount: bigint, token: FreeRouteToken): Step[] => {
  const approveExact: Step = { kind: 'approve', detail: `${token.symbol}.approve(router, ${fmtUnits(amount, token.decimals, token.decimals)})` };
  if (approval === 'resetThenApprove') return [{ kind: 'approve', detail: `${token.symbol}.approve(router, 0)` }, approveExact];
  if (approval === 'approve') return [approveExact];
  return []; // 'none' — native XTZ input, or the allowance already covers it
};

// ───────────────────────────── BUYER: pay an ERC20 for an XTZ-priced ask ─────────────────────────────
export async function buildEvmBuyBatch(
  evmAddress: string,
  ask: { askId: string; tokenId: string; priceMutez: number },
  payToken: FreeRouteToken,
  slippageBps: number,
): Promise<{ txs: EvmTxRequest[]; details: BuyDetails }> {
  // exact-out: size the XTZ out so the on-chain floor still covers the ask price
  const minOutTarget = targetForMinOut(BigInt(ask.priceMutez), slippageBps);
  const swap = await freeRoute.getSwap({
    src: payToken.address,
    dst: XTZ.address,
    amount: toEvmUnits(minOutTarget, XTZ.address),
    isExactOut: true,
    from: evmAddress,
    receiver: evmAddress,
    slippageBps,
  });
  const srcAmount = swap.srcAmount;

  const approval = await resolveApproval({ evmRpc: CFG.evmRpc, token: payToken.address, owner: evmAddress, spender: swap.tx.to, amount: srcAmount });
  const swapTxs = buildEvmSwapTransaction({ swap, srcAddress: payToken.address, approval });
  const fulfillTx = objkt.buildEvmFulfillAskTransaction({ marketplace: CFG.objkt, askId: ask.askId, editions: 1, amountMutez: ask.priceMutez });

  const expectedOutMutez = Number(fromEvmUnits(swap.dstAmount, XTZ.address));
  const minOutMutez = Number(fromEvmUnits(swap.dstAmountMin, XTZ.address));

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
    steps: [
      ...approveSteps(approval, srcAmount, payToken),
      { kind: 'swap', detail: 'router.swap() —XTZ→ evm account' },
      { kind: 'fulfill_ask', detail: 'callMichelson(fulfill_ask()) —NFT→ michelson alias' },
    ],
  };
  return { txs: [...swapTxs, fulfillTx], details };
}

// ───────────────────────────── BRIDGE: swap any token -> any token on the evm account ─────────────────────────────
export async function buildEvmSwapBatch(
  evmAddress: string,
  src: FreeRouteToken,
  dst: FreeRouteToken,
  amount: bigint,
  slippageBps: number,
): Promise<{ txs: EvmTxRequest[]; details: SwapDetails }> {
  const swap = await freeRoute.getSwap({
    src: src.address,
    dst: dst.address,
    amount: toEvmUnits(amount, src.address),
    isExactOut: false,
    from: evmAddress,
    receiver: evmAddress,
    slippageBps,
  });

  // native XTZ input carries msg.value (no approve); an ERC20 picks the minimal safe mode
  const approval: ApprovalMode = isXtz(src.address)
    ? 'none'
    : await resolveApproval({ evmRpc: CFG.evmRpc, token: src.address, owner: evmAddress, spender: swap.tx.to, amount: swap.srcAmount });
  const txs = buildEvmSwapTransaction({ swap, srcAddress: src.address, approval });
  const payAmount = fromEvmUnits(swap.srcAmount, src.address);

  const details: SwapDetails = {
    src,
    dst,
    payAmount,
    expectedOut: fromEvmUnits(swap.dstAmount, dst.address),
    minOut: fromEvmUnits(swap.dstAmountMin, dst.address),
    slippageBps,
    router: swap.tx.to,
    approval,
    steps: [...approveSteps(approval, swap.srcAmount, src), { kind: 'swap', detail: `router.swap() —${dst.symbol}→ evm account` }],
  };
  return { txs, details };
}

// ───────────────────────────── SELLER: mint + list via the gateway's callMichelson ─────────────────────────────
// Each Michelson op (mint / update_operators / ask) becomes a callMichelson EVM tx: msg.sender on Michelson is
// the account's michelson alias (KT1), so the NFT mints to it, the alias approves objkt, and the ask is listed by
// it. Michelson values mirror lib/opsMichelson.ts exactly; we forge them against the real contract types (verified).

type Mich = { prim?: string; args?: Mich[]; string?: string; int?: string; bytes?: string } | Mich[];

const m = {
  string: (s: string): Mich => ({ string: s }),
  int: (n: number | string): Mich => ({ int: String(n) }),
  pair: (...a: Mich[]): Mich => ({ prim: 'Pair', args: a }),
  left: (x: Mich): Mich => ({ prim: 'Left', args: [x] }),
  right: (x: Mich): Mich => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as Mich,
  none: { prim: 'None' } as Mich,
};

const addOperatorValue = (owner: string, operator: string, tokenId: number): Mich =>
  [m.left(m.pair(m.string(owner), m.string(operator), m.int(tokenId)))];

const askValue = (fa2: string, tokenId: number, priceMutez: number, seller: string): Mich =>
  m.pair(
    m.pair(m.string(fa2), m.int(tokenId)),
    m.right(m.right(m.unit)), // currency = %tez
    m.int(priceMutez),
    m.int(1), // editions
    [{ prim: 'Elt', args: [m.string(seller), m.int(1000)] }], // %shares: seller -> 100%
    m.none, // start_time
    m.none, // expiry_time
    m.int(0), // referral_bonus
    m.none, // condition
  );

// Contract param types — forge needs them to pack addresses/ints. Extracted from the deployed contracts;
// annotations are omitted because they don't affect value forging / PACK.
const MINT_TYPE = { prim: 'address' };
const UPDATE_OPERATORS_TYPE = {
  prim: 'list',
  args: [{ prim: 'or', args: [{ prim: 'pair', args: [{ prim: 'address' }, { prim: 'address' }, { prim: 'nat' }] }, { prim: 'pair', args: [{ prim: 'address' }, { prim: 'address' }, { prim: 'nat' }] }] }],
};
const O = (...args: unknown[]) => ({ prim: 'option', args });
const P = (...args: unknown[]) => ({ prim: 'pair', args });
const ASK_TYPE = P(
  P({ prim: 'address' }, { prim: 'nat' }), // %token (address, token_id)
  P(
    { prim: 'or', args: [{ prim: 'address' }, { prim: 'or', args: [P({ prim: 'address' }, { prim: 'nat' }), { prim: 'unit' }] }] }, // %currency (fa12 | fa2 | tez)
    P(
      { prim: 'nat' }, // %amount
      P(
        { prim: 'nat' }, // %editions
        P(
          { prim: 'map', args: [{ prim: 'address' }, { prim: 'nat' }] }, // %shares
          P(
            O({ prim: 'timestamp' }), // %start_time
            P(
              O({ prim: 'timestamp' }), // %expiry_time
              P({ prim: 'nat' }, O(P({ prim: 'address' }, { prim: 'bytes' }))), // %referral_bonus, %condition
            ),
          ),
        ),
      ),
    ),
  ),
);

// Forge a Michelson value to gateway calldata, typed via the SDK fn's own params (avoids a michel-codec import).
type ForgeData = Parameters<typeof forgeMichelson>[0];
type ForgeType = Parameters<typeof forgeMichelson>[1];
const callMichelson = (destination: string, entrypoint: string, value: Mich, type: unknown): EvmTxRequest =>
  buildCallMichelsonTransaction({ destination, entrypoint, data: forgeMichelson(value as ForgeData, type as ForgeType), evmGateway: EVM_GATEWAY });

/** Mint + list `items` from the EVM side. `seller` is the account's michelson alias (KT1) — owner of the new NFTs. */
export function buildEvmMintListBatch(
  seller: string,
  items: SellerItem[],
  baseTokenId: number,
): { txs: EvmTxRequest[]; stepLabels: string[] } {
  const txs: EvmTxRequest[] = [];
  const stepLabels: string[] = [];
  // interleave per token (mint -> approve objkt -> list) so a partial run still leaves fully-listed NFTs
  items.forEach((it, i) => {
    const id = baseTokenId + i;
    txs.push(callMichelson(CFG.fa2, 'mint', m.string(seller), MINT_TYPE));
    stepLabels.push(`mint #${id}`);
    txs.push(callMichelson(CFG.fa2, 'update_operators', addOperatorValue(seller, CFG.objkt, id), UPDATE_OPERATORS_TYPE));
    stepLabels.push(`approve objkt #${id}`);
    txs.push(callMichelson(CFG.objkt, 'ask', askValue(CFG.fa2, id, it.priceMutez, seller), ASK_TYPE));
    stepLabels.push(`list #${id}`);
  });
  return { txs, stepLabels };
}
