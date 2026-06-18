// dApp's view of the SDK. Pure builders/types run in the browser; the keyed free-route client lives server-side
// (lib/server/freeRoute.ts) behind /api/free-route/*, and the browser uses the keyless shim below.
export {
  XTZ,
  XTZ_ADDRESS,
  isXtz,
  toEvm,
  fromEvm,
  targetForMinOut,
  michelsonToEvmAlias,
  objkt,
  buildSwapOperation,
  buildBatchTransaction,
  resolveApproval,
  xtzMutezToWei,
} from '@sdk/index.js';
export type { FreeRouteToken, ApprovalMode } from '@sdk/index.js';

import type { Quote, QuoteQuery, QuoteResponseDto, Swap, SwapResponseDto, FreeRouteApi, FreeRouteToken } from '@sdk/index.js';
import { parseQuote, parseSwap } from '@sdk/index.js';
import { queryToParams } from './freeRouteDto';

// Same-origin call to our endpoints (no key — injected server-side); surfaces the server's {error} message.
async function get<T>(path: string, q?: QuoteQuery): Promise<T> {
  const url = q ? `/api/free-route/${path}?${queryToParams(q)}` : `/api/free-route/${path}`;
  const r = await fetch(url);
  if (!r.ok) {
    const msg = await r
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => null);
    throw new Error(`free-route ${path} -> ${msg ?? `HTTP ${r.status}`}`);
  }
  return r.json() as Promise<T>;
}

// Browser shim for the free-route read surface — fetches wire DTOs from our BFF and parses them into models.
export const freeRoute: FreeRouteApi = {
  getTokens: () => get<FreeRouteToken[]>('tokens'),
  getQuote: async (q): Promise<Quote> => parseQuote(await get<QuoteResponseDto>('quote', q)),
  getSwap: async (q): Promise<Swap> => parseSwap(await get<SwapResponseDto>('swap', q)),
};
