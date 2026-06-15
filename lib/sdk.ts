// dApp's view of the SDK. Pure builders/types run in the browser; the keyed 3route client lives server-side
// (lib/server/threeRoute.ts) behind /api/3route/*, and the browser uses the keyless shim below.
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
export type { ThreeRouteToken, ApprovalMode } from '@sdk/index.js';

import type { Quote, QuoteQuery, QuoteResponseDto, Swap, SwapResponseDto, ThreeRouteApi, ThreeRouteToken } from '@sdk/index.js';
import { parseQuote, parseSwap } from '@sdk/index.js';
import { queryToParams } from './threeRouteDto';

// Same-origin call to our endpoints (no key — injected server-side); surfaces the server's {error} message.
async function get<T>(path: string, q?: QuoteQuery): Promise<T> {
  const url = q ? `/api/3route/${path}?${queryToParams(q)}` : `/api/3route/${path}`;
  const r = await fetch(url);
  if (!r.ok) {
    const msg = await r
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => null);
    throw new Error(`3route ${path} -> ${msg ?? `HTTP ${r.status}`}`);
  }
  return r.json() as Promise<T>;
}

// Browser shim for the 3route read surface — fetches wire DTOs from our BFF and parses them into models.
export const threeRoute: ThreeRouteApi = {
  getTokens: () => get<ThreeRouteToken[]>('tokens'),
  getQuote: async (q): Promise<Quote> => parseQuote(await get<QuoteResponseDto>('quote', q)),
  getSwap: async (q): Promise<Swap> => parseSwap(await get<SwapResponseDto>('swap', q)),
};
