// Query <-> URLSearchParams at the dApp's own /api/3route/* boundary. queryToParams serializes (browser);
// parse{Quote,Swap}Query validate UNTRUSTED params (server) — parseSwapQuery additionally requires `from`.
import type { EvmAddress, QuoteQuery, SwapQuery } from '@sdk/index.js';

export function queryToParams(q: QuoteQuery & Partial<Pick<SwapQuery, 'from' | 'receiver' | 'slippagePercent'>>): URLSearchParams {
  const p = new URLSearchParams({ src: q.src, dst: q.dst, amount: q.amount.toString() });
  if (q.isExactOut !== undefined) p.set('isExactOut', String(q.isExactOut));
  if (q.slippagePercent !== undefined) p.set('slippagePercent', String(q.slippagePercent)); // swap-only
  if (q.from) p.set('from', q.from);
  if (q.receiver) p.set('receiver', q.receiver);
  return p;
}

const isAddress = (s: string): s is EvmAddress => /^0x[0-9a-fA-F]{40}$/.test(s); // 0x + 40 hex (XTZ_ADDRESS too)

export function parseQuoteQuery(params: URLSearchParams): QuoteQuery {
  const src = params.get('src');
  const dst = params.get('dst');
  const amount = params.get('amount');
  if (!src || !isAddress(src)) throw new Error('bad or missing `src` (expected a 0x address)');
  if (!dst || !isAddress(dst)) throw new Error('bad or missing `dst` (expected a 0x address)');
  if (!amount || !/^\d+$/.test(amount)) throw new Error('bad or missing `amount` (expected a non-negative integer)');

  const q: QuoteQuery = { src, dst, amount: BigInt(amount) };

  const isExactOut = params.get('isExactOut');
  if (isExactOut !== null) {
    if (isExactOut !== 'true' && isExactOut !== 'false') throw new Error('`isExactOut` must be "true" or "false"');
    q.isExactOut = isExactOut === 'true';
  }

  return q;
}

export function parseSwapQuery(params: URLSearchParams): SwapQuery {
  const base = parseQuoteQuery(params);
  const from = params.get('from');
  if (!from || !isAddress(from)) throw new Error('bad or missing `from` (required for a swap, expected a 0x address)');

  const swap: SwapQuery = { ...base, from };

  const receiver = params.get('receiver'); // optional — the server defaults it to `from`
  if (receiver !== null) {
    if (!isAddress(receiver)) throw new Error('`receiver` must be a 0x address');
    swap.receiver = receiver;
  }

  const slippage = params.get('slippagePercent'); // swap-only — shapes dstAmountMin
  if (slippage !== null) {
    const n = Number(slippage);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('`slippagePercent` must be a number in 0..100');
    swap.slippagePercent = n;
  }

  return swap;
}
