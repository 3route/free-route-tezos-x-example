# objkt EVM-pay — demo dApp

Next.js SPA on top of the pure **[3route-tezosx SDK](https://github.com/maxima-net/evm-objkt)**, consumed as a
git submodule at [`3route-tezosx/`](3route-tezosx) (source-imported via the `@sdk/*` path alias → `3route-tezosx/src`). Pages
(header tabs, real routes):

- **Buyer** (`/`) — browse active listings, see tz1 / EVM-alias balances, pick any ERC20 (USDC / uranium /
  gold …), review, and buy — one atomic Tezos op-group `[approve, swap (call_evm), fulfill_ask]`.
- **Seller** (`/seller`) — mint N fresh NFTs into the test FA2 and list them as XTZ-priced asks on objkt.
- **My NFTs** (`/owned`) — tokens owned by the connected Michelson address.
- **Bridge** (`/bridge`) — swap any balance token ↔ XTZ/ERC20 via the same op-group; measured receipt.

Signing is client-side via **Temple/Beacon**. Read-only data comes from tzkt + the EVM RPC; 3route reads are
proxied through `/api/3route/*` (server-side) — avoids browser CORS and keeps the api key off the client.

## Run

```bash
# clone WITH the SDK submodule
git clone --recurse-submodules git@github.com:maxima-net/evm-objkt-example.git
cd evm-objkt-example
# (if you cloned without --recurse-submodules)
git submodule update --init

npm install
npm run dev          # http://localhost:3001
```

Point `THREE_ROUTE_API` at a running 3route server (defaults to `http://127.0.0.1:3000`). Connect Temple
configured for **Tezos X previewnet**. Need test XTZ? The Bridge page links to the faucet.

To update the SDK to its latest commit: `git submodule update --remote 3route-tezosx` then commit the bump.

## Config

Working previewnet defaults live in `lib/config.ts`; override via `.env.local` (see `.env.local.example`).
`THREE_ROUTE_API` / `THREE_ROUTE_API_KEY` are server-only (the proxy injects the key; it never reaches the browser).

## Layout

- `lib/sdk.ts` — browser adapter: re-exports the pure-SDK builders/types + a keyless `threeRoute` shim hitting `/api/3route/*`.
- `lib/server/threeRoute.ts` — the keyed 3route client (server-only).
- `app/api/3route/*` — typed BFF endpoints (validate, key-inject, forward).
- `lib/ops.ts` — buy + swap batch builders (the SDK usage); `lib/receipt.ts` — measured post-op receipts.
- `lib/wallet.ts` — Beacon connection + a wallet-bound `TezosToolkit`.
- `components/*` — Header, Buyer/Seller/Owned/Bridge panels, Buy/Bridge modals, receipts, activity log.
