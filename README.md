# Tezos X — free-route SDK demo dApp

> [!WARNING]
> **Not production-ready.** This app only demonstrates how to integrate the
> [`@baking-bad/free-route-tezos-x`](https://github.com/3route/free-route-tezos-x) SDK — it is not audited or hardened.
> Running it against mainnet is entirely at your own risk.

**Live demo: [3route-tezos-x-sdk-demo.vercel.app](https://3route-tezos-x-sdk-demo.vercel.app)**

A Next.js **reference integration** of the **[@baking-bad/free-route-tezos-x](https://github.com/3route/free-route-tezos-x)**
SDK (consumed as an npm package), on **Tezos X previewnet**. It drives every flow from **both wallet sides** —
**Temple** (a single-signature Michelson op-group) and **MetaMask** (an EVM tx batch):

- **Buyer** (`/`) — pay any ERC20 for an XTZ-priced objkt NFT (swap → fulfill, composed atomically). Optional NFT recipient (objkt `proxy_for`).
- **Bridge** (`/bridge`) — swap any token ↔ any token. Optional `0x` receiver for the output.
- **Seller** (`/seller`) — mint + list test NFTs as XTZ-priced asks on objkt.
- **My NFTs** (`/owned`) — tokens owned by the connected wallet's Michelson holder (your tz1, or the account's KT1 alias on MetaMask).

Signing is client-side (Temple/Beacon · MetaMask/EIP-6963). The free-route **API key stays server-side** — reads are
proxied through `/api/free-route/*` (the BFF), so the key never reaches the browser.

**For the full architecture, the server/client key split, and copy-paste SDK examples per flow, see the
[**Docs** page](https://3route-tezos-x-sdk-demo.vercel.app/docs)** (source: [`app/docs/page.tsx`](app/docs/page.tsx)).
The SDK's own [README](https://github.com/3route/free-route-tezos-x#readme) has the API reference.

## Run

```bash
npm install
npm run dev          # http://localhost:3001
```

Connect Temple (or MetaMask) on **Tezos X previewnet** — the Bridge page links to the faucet for test XTZ. Working
previewnet defaults live in `lib/config.ts`; override via `.env.local` (`FREE_ROUTE_API` / `FREE_ROUTE_API_KEY` are
server-only).
