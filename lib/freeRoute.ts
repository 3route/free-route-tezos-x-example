// Browser shim for the free-route read surface — a keyless FreeRouteApi over our /api/free-route/* proxy.
// Mirror of lib/server/freeRoute.ts: same interface, but the API key stays server-side (injected behind the proxy).
import type { Quote, QuoteResponseDto, Swap, SwapResponseDto, FreeRouteApi, FreeRouteToken } from '@baking-bad/free-route-tezos-x';
import { parseQuote, parseSwap, serializeQuoteQuery, serializeSwapQuery } from '@baking-bad/free-route-tezos-x';

// Same-origin call to our endpoints (no key — injected server-side); surfaces the server's {error} message.
async function get<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = params ? `/api/free-route/${path}?${params}` : `/api/free-route/${path}`;
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
  getQuote: async (q): Promise<Quote> => parseQuote(await get<QuoteResponseDto>('quote', serializeQuoteQuery(q))),
  getSwap: async (q): Promise<Swap> => parseSwap(await get<SwapResponseDto>('swap', serializeSwapQuery(q))),
};
