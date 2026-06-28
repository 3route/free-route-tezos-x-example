# objkt EVM-pay — demo dApp

> [!WARNING]
> **Not production-ready.** This app only demonstrates how to integrate the
> [`@baking-bad/free-route-tezos-x`](https://github.com/3route/free-route-tezos-x) SDK — it is not audited or hardened
> for real use. Running it against mainnet is entirely at your own risk.

Next.js SPA on top of the **[@baking-bad/free-route-tezos-x SDK](https://github.com/3route/free-route-tezos-x)**, consumed as
an npm package. Pages (header tabs, real routes):

- **Buyer** (`/`) — browse active listings, see tz1 / EVM-alias balances, pick any ERC20 (USDC / uranium /
  gold …), review, and buy — one atomic Tezos op-group `[approve, swap (call_evm), fulfill_ask]`.
- **Seller** (`/seller`) — mint N fresh NFTs into the test FA2 and list them as XTZ-priced asks on objkt.
- **My NFTs** (`/owned`) — tokens owned by the connected Michelson address.
- **Bridge** (`/bridge`) — swap any balance token ↔ XTZ/ERC20 via the same op-group; measured receipt.

Signing is client-side via **Temple/Beacon**. Read-only data comes from tzkt + the EVM RPC; free-route reads are
proxied through `/api/free-route/*` (server-side) — avoids browser CORS and keeps the api key off the client.

## Run

```bash
git clone git@github.com:3route/free-route-tezos-x-example.git
cd free-route-tezos-x-example
npm install
npm run dev          # http://localhost:3001
```

Point `FREE_ROUTE_API` at a running free-route server (defaults to `http://127.0.0.1:3000`). Connect Temple
configured for **Tezos X previewnet**. Need test XTZ? The Bridge page links to the faucet.

To update the SDK: `npm i @baking-bad/free-route-tezos-x@latest` then commit the bump.

## Config

Working previewnet defaults live in `lib/config.ts`; override via `.env.local` (see `.env.local.example`).
`FREE_ROUTE_API` / `FREE_ROUTE_API_KEY` are server-only (the proxy injects the key; it never reaches the browser).

## Layout

- `lib/sdk.ts` — browser adapter: re-exports the pure-SDK builders/types + a keyless `freeRoute` shim hitting `/api/free-route/*`.
- `lib/server/freeRoute.ts` — the keyed free-route client (server-only).
- `app/api/free-route/*` — typed BFF endpoints (validate, key-inject, forward).
- `lib/ops.ts` — buy + swap batch builders (the SDK usage); `lib/receipt.ts` — measured post-op receipts.
- `lib/wallet.ts` — Beacon connection + a wallet-bound `TezosToolkit`.
- `components/*` — Header, Buyer/Seller/Owned/Bridge panels, Buy/Bridge modals, receipts, activity log.
