import 'server-only'; // build-time guard: importing this into a client bundle is an error
import { ThreeRouteClient, tezosXPreviewnet } from '@sdk/index.js';

// The keyed 3route client — server-side only; the api key (server-only env, not NEXT_PUBLIC) never hits the browser.
export const threeRoute = new ThreeRouteClient({
  baseUrl: process.env.THREE_ROUTE_API ?? tezosXPreviewnet.apiBaseUrl ?? 'http://127.0.0.1:3000',
  chainId: tezosXPreviewnet.chainId,
  apiKey: process.env.THREE_ROUTE_API_KEY, // 'YourApiKey' for a hosted server; omit for the keyless dev server
});
