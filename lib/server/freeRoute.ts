import 'server-only'; // build-time guard: importing this into a client bundle is an error
import { FreeRouteClient, tezosXPreviewnet } from '@baking-bad/free-route-tezos-x';

// The keyed free-route client — server-side only; the api key (server-only env, not NEXT_PUBLIC) never hits the browser.
export const freeRoute = new FreeRouteClient({
  baseUrl: process.env.FREE_ROUTE_API ?? 'http://127.0.0.1:3000',
  chainId: tezosXPreviewnet.chainId,
  apiKey: process.env.FREE_ROUTE_API_KEY, // free-route API key
});
