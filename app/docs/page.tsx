// /docs — what this demo is and how the package API is used. Static content; shell from AppShell.
// Code samples are syntax-highlighted at build time with shiki (server-side — no client JS).
import { codeToHtml } from 'shiki';
import { CodeBlock } from '@/components/CodeBlock';

const NPM = 'https://www.npmjs.com/package/@baking-bad/free-route-tezos-x';
const GITHUB = 'https://github.com/3route/free-route-tezos-x';

function NpmIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="#CB3837" aria-hidden="true">
      <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331zM10.665 10H12v2.667h-1.335V10z" />
    </svg>
  );
}

function GhIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

interface PageDoc {
  title: string;
  href: string;
  blurb: string;
  code?: string; // pseudocode example (Buyer/Bridge); supporting pages omit it
}

const BUYER_CODE = `import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import {
  FreeRouteTezosX, tezosXMainnet, XTZ, toEvmUnits, targetForMinOut,
  michelsonToEvmAlias, resolveApproval, objkt, buildBatchTransaction,
} from '@baking-bad/free-route-tezos-x';

// your Taquito toolkit + signer (a Beacon wallet in a browser dApp)
const tezos = new TezosToolkit(MICHELSON_RPC);
tezos.setSignerProvider(new InMemorySigner(SECRET_KEY));

const freeRoute = new FreeRouteTezosX({
  baseUrl: FREE_ROUTE_API,
  network: tezosXMainnet,
  apiKey: FREE_ROUTE_API_KEY, // free-route API key
});

const buyerAddress = await tezos.signer.publicKeyHash();   // your Michelson (tz1) address
const buyerAlias = michelsonToEvmAlias(buyerAddress);      // its EVM identity (holds the ERC20)
const payToken = (await freeRoute.getTokens()).find((token) => token.symbol === 'USDC')!;

const priceMutez = 4_000n; // the objkt ask price (read it from the marketplace)
const slippageBps = 200;   // 2%

// exact-out: size the XTZ out so the on-chain floor still covers the price
const minOutTarget = targetForMinOut(priceMutez, slippageBps);
const swapAmount = toEvmUnits(minOutTarget, XTZ.address); // mutez -> wei for the EVM API
const swap = await freeRoute.getSwap({
  src: payToken.address,
  dst: XTZ.address,
  amount: swapAmount,
  isExactOut: true,
  from: buyerAlias,
  receiver: buyerAlias,
  slippageBps,
});

// read the on-chain allowance -> pick the minimal safe approval mode (none / approve / reset+approve)
const approval = await resolveApproval({
  evmRpc: EVM_RPC,
  token: payToken.address,
  owner: buyerAlias,
  spender: swap.tx.to,
  amount: swap.srcAmount,
});

// approve(s) + swap, composed with the objkt fulfill -> one atomic group
const swapOps = freeRoute.michelson.buildSwapOperation({
  swap,
  srcAddress: payToken.address,
  approval,
});
const fulfill = objkt.buildMichelsonFulfillAskOperation({
  marketplace: OBJKT_MARKETPLACE,
  askId: '1',
  editions: 1,
  amountMutez: priceMutez,
  // recipient: 'tz1… | KT1…', // optional: send the NFT to another Michelson address (objkt proxy_for)
});

const ops = buildBatchTransaction(swapOps, fulfill);
const op = await tezos.contract.batch().with(ops).send(); // a single signature
await op.confirmation();`;

const BRIDGE_CODE = `import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import {
  FreeRouteTezosX, tezosXMainnet, XTZ, toEvmUnits, isXtz,
  michelsonToEvmAlias, resolveApproval,
} from '@baking-bad/free-route-tezos-x';

const tezos = new TezosToolkit(MICHELSON_RPC);
tezos.setSignerProvider(new InMemorySigner(SECRET_KEY));

const freeRoute = new FreeRouteTezosX({
  baseUrl: FREE_ROUTE_API,
  network: tezosXMainnet,
  apiKey: FREE_ROUTE_API_KEY, // free-route API key
});

const myAddress = await tezos.signer.publicKeyHash();
const alias = michelsonToEvmAlias(myAddress); // EVM identity that runs the swap
const slippageBps = 50;                        // 0.5%

// pick any pair + the amount in src base units
const tokens = await freeRoute.getTokens();
const src = tokens.find((token) => token.symbol === 'USDC')!;
const dst = XTZ;            // receive native XTZ
const amount = 1_000_000n; // 1 USDC

// exact-in: any token -> any token (XTZ <-> ERC20, ERC20 <-> ERC20)
const swapAmount = toEvmUnits(amount, src.address); // to wei for the EVM API
const swap = await freeRoute.getSwap({
  src: src.address,
  dst: dst.address,
  amount: swapAmount,
  isExactOut: false,
  from: alias,
  receiver: alias, // optional: any EVM 0x address — the swap output lands here (defaults to the sender)
  slippageBps,
});

// native XTZ carries value as msg.value (no approve); an ERC20 picks the minimal safe mode (none / approve / reset+approve)
const approval = isXtz(src.address)
  ? 'none'
  : await resolveApproval({
      evmRpc: EVM_RPC,
      token: src.address,
      owner: alias,
      spender: swap.tx.to,
      amount: swap.srcAmount,
    });

// approve(s) + swap -> one atomic group; native-XTZ output auto-forwards to your Michelson address
const ops = freeRoute.michelson.buildSwapOperation({
  swap,
  srcAddress: src.address,
  approval,
});
const op = await tezos.contract.batch().with(ops).send(); // a single signature
await op.confirmation();`;

const EVM_BUYER_CODE = `import {
  FreeRouteTezosXEvm, tezosXPreviewnet, XTZ, toEvmUnits, targetForMinOut,
  evmToMichelsonAlias, resolveApproval, objkt,
} from '@baking-bad/free-route-tezos-x/evm';

const freeRoute = new FreeRouteTezosXEvm({
  baseUrl: FREE_ROUTE_API,
  network: tezosXPreviewnet,
  apiKey: FREE_ROUTE_API_KEY, // free-route API key
});

const buyerAccount = '0x…';                           // the MetaMask account (holds the ERC20, pays gas)
const buyerAlias = evmToMichelsonAlias(buyerAccount); // the KT1 where the NFT lands
const payToken = (await freeRoute.getTokens()).find((token) => token.symbol === 'USDC')!;

const priceMutez = 4_000n; // the objkt ask price (read it from the marketplace)
const slippageBps = 200;   // 2%

// exact-out: size the XTZ out so the on-chain floor still covers the price
const minOutTarget = targetForMinOut(priceMutez, slippageBps);
const swapAmount = toEvmUnits(minOutTarget, XTZ.address); // mutez -> wei for the EVM API
const swap = await freeRoute.getSwap({
  src: payToken.address,
  dst: XTZ.address,
  amount: swapAmount,
  isExactOut: true,
  from: buyerAccount,
  receiver: buyerAccount,
  slippageBps,
});

// read the on-chain allowance -> pick the minimal safe approval mode (none / approve / reset+approve)
const approval = await resolveApproval({
  evmRpc: EVM_RPC,
  token: payToken.address,
  owner: buyerAccount,
  spender: swap.tx.to,
  amount: swap.srcAmount,
});

// approve(s) + swap, composed with the objkt fulfill (via callMichelson) -> one EvmTxRequest[] batch
const swapTxs = freeRoute.evm.buildSwapTransaction({ swap, srcAddress: payToken.address, approval });
const fulfill = objkt.buildEvmFulfillAskTransaction({
  marketplace: OBJKT_MARKETPLACE,
  askId: '1',
  editions: 1,
  amountMutez: priceMutez,
  // recipient: 'tz1… | KT1…', // optional: send the NFT to another Michelson address (objkt proxy_for)
});

// EIP-5792 batch where supported; otherwise send sequentially (this previewnet). NFT lands on buyerAlias.
await walletClient.sendCalls({ calls: [...swapTxs, fulfill] });`;

const SERVER_CODE = `// lib/server/freeRoute.ts -- the free-route API key lives here, never in the browser
import 'server-only';
import { FreeRouteClient, tezosXPreviewnet, serializeQuote, serializeSwap } from '@baking-bad/free-route-tezos-x';

export const freeRoute = new FreeRouteClient({
  baseUrl: process.env.FREE_ROUTE_API!,
  chainId: tezosXPreviewnet.chainId,
  apiKey: process.env.FREE_ROUTE_API_KEY!, // server-only env, never NEXT_PUBLIC
});

// thin proxy endpoints -- each route.ts exports a GET over the keyed client above
import type { NextRequest } from 'next/server';
import { parseQuoteQuery, parseSwapQuery } from '@baking-bad/free-route-tezos-x'; // SDK codec: validate untrusted params

// app/api/free-route/tokens/route.ts -- plain JSON, no bigints, no serialize step
export async function GET() {
  const tokens = await freeRoute.getTokens();
  return Response.json(tokens);
}

// app/api/free-route/quote/route.ts -- serialize* turns the model into a wire DTO (JSON can't carry bigint)
export async function GET(req: NextRequest) {
  const query = parseQuoteQuery(req.nextUrl.searchParams); // validate untrusted params
  const quote = await freeRoute.getQuote(query);
  return Response.json(serializeQuote(quote));
}

// app/api/free-route/swap/route.ts
export async function GET(req: NextRequest) {
  const query = parseSwapQuery(req.nextUrl.searchParams);
  const swap = await freeRoute.getSwap(query);
  return Response.json(serializeSwap(swap));
}`;

const CLIENT_CODE = `// lib/freeRoute.ts -- a keyless client implementing the SDK's FreeRouteApi, via our proxy
import {
  parseQuote, parseSwap, serializeQuoteQuery, serializeSwapQuery,
  type FreeRouteApi, type FreeRouteToken, type QuoteResponseDto, type SwapResponseDto,
} from '@baking-bad/free-route-tezos-x';

// same-origin fetch to our proxy endpoints (the key is injected server-side)
async function get<T>(path: string, params?: URLSearchParams): Promise<T> {
  const qs = params ? '?' + params : '';
  const res = await fetch('/api/free-route/' + path + qs);
  return res.json();
}

// FreeRouteApi is the SDK's read surface; serialize the query, parse each wire DTO back into a typed model.
export const freeRoute: FreeRouteApi = {
  getTokens: () => get<FreeRouteToken[]>('tokens'),
  getQuote: async (q) => parseQuote(await get<QuoteResponseDto>('quote', serializeQuoteQuery(q))), // bigints restored
  getSwap: async (q) => parseSwap(await get<SwapResponseDto>('swap', serializeSwapQuery(q))),
};

// ── elsewhere (browser): turn those keyless reads into ops with a network-keyed builder.
//    The builder needs only the gateway, so no API key leaves the server. This is lib/opsMichelson.ts. ──
import { createMichelsonOpsBuilder, tezosXPreviewnet } from '@baking-bad/free-route-tezos-x';

const michelson = createMichelsonOpsBuilder(tezosXPreviewnet.michelsonGateway); // pure builder, runs anywhere

const swap = await freeRoute.getSwap({ src, dst, amount, isExactOut: true, from, receiver });
const swapOps = michelson.buildSwapOperation({ swap, srcAddress: src });
// sign swapOps with your Beacon/Taquito wallet — or compose with a marketplace op (see the Buyer example).
// The EVM side mirrors this: createEvmOpsBuilder(tezosXPreviewnet.evmGateway) -> evm.buildSwapTransaction(...).`;

const PAGES: PageDoc[] = [
  {
    title: 'Buyer',
    href: '/buyer',
    blurb:
      'Pay any EVM ERC20 for an XTZ-priced objkt NFT — swap to XTZ, then fulfill the ask, composed into one signed batch. From Temple it’s a single-signature Michelson op-group; from MetaMask, an EVM tx batch that reaches objkt via callMichelson. The NFT goes to the signer by default, or to any Michelson address you pass as the objkt proxy_for (the optional recipient).',
    code: BUYER_CODE,
  },
  {
    title: 'Bridge',
    href: '/bridge',
    blurb:
      'A standalone swap of any token to any token (XTZ ↔ ERC20, ERC20 ↔ ERC20), exact-input. The same builders as the buy, minus the marketplace op. The output lands on the signer by default, or on any EVM address you pass as the receiver.',
    code: BRIDGE_CODE,
  },
  {
    title: 'Seller',
    href: '/seller',
    blurb:
      'Mints test NFTs and lists each as an XTZ-priced ask on objkt, so the Buyer page has something to purchase. Supporting flow for the demo.',
  },
  {
    title: 'My NFTs',
    href: '/owned',
    blurb:
      'A read-only view of the NFTs owned by the connected wallet’s Michelson holder — your tz1 (Temple) or the account’s KT1 alias (MetaMask) — from the test collection. Confirms a completed buy.',
  },
];

export default async function DocsPage() {
  // highlight each sample server-side (shiki) — pre-rendered HTML, no client JS
  const codeHtml: Record<string, string> = Object.fromEntries(
    await Promise.all(
      PAGES.filter((p) => p.code).map(
        async (p) => [p.href, await codeToHtml(p.code as string, { lang: 'ts', theme: 'github-dark' })] as const,
      ),
    ),
  );
  const serverHtml = await codeToHtml(SERVER_CODE, { lang: 'ts', theme: 'github-dark' });
  const clientHtml = await codeToHtml(CLIENT_CODE, { lang: 'ts', theme: 'github-dark' });
  const evmHtml = await codeToHtml(EVM_BUYER_CODE, { lang: 'ts', theme: 'github-dark' });

  return (
    <div className="space-y-5">
      {/* not-production-ready note */}
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
        <span className="font-semibold">⚠️ Not production-ready.</span> This app only demonstrates how to integrate the{' '}
        <span className="font-mono">@baking-bad/free-route-tezos-x</span> SDK — it is not audited or hardened for real
        use. Running it against mainnet is entirely at your own risk.
      </div>

      {/* intro */}
      <div className="card">
        <h1 className="text-lg font-semibold">Demo docs</h1>
        <p className="mt-2 text-sm text-slate-400">
          A reference integration of{' '}
          <a className="font-mono text-accent hover:underline" href={NPM} target="_blank" rel="noreferrer">
            @baking-bad/free-route-tezos-x
          </a>{' '}
          — an SDK that turns <span className="text-slate-300">free-route swaps</span> on Tezos X into ready-to-sign Tezos
          operations. This app exercises two flows: a standalone any-token ↔ any-token swap (the{' '}
          <a className="text-accent hover:underline" href="/bridge">
            Bridge
          </a>
          ), and{' '}
          <a className="text-accent hover:underline" href="/buyer">
            paying any ERC20 for an XTZ-priced asset
          </a>{' '}
          (e.g. an objkt NFT), composed into ready-to-sign ops. Either flow can be driven from <span className="text-slate-300">either side</span> — a
          Michelson op-group (Temple) or an EVM tx batch (MetaMask).
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="btn-ghost" href={NPM} target="_blank" rel="noreferrer">
            <NpmIcon /> @baking-bad/free-route-tezos-x
          </a>
          <a className="btn-ghost" href={GITHUB} target="_blank" rel="noreferrer">
            <GhIcon /> SDK on GitHub
          </a>
        </div>
      </div>

      {/* how it works */}
      <div className="card">
        <div className="label mb-2">How the SDK works</div>
        <p className="text-sm text-slate-400">
          Tezos X is one chain with two interfaces — Michelson (Tezlink) and EVM (Etherlink) — that can call each other
          atomically in a single transaction. The SDK prepares the calls for whichever side signs:
        </p>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-400">
          <li>
            <span className="text-slate-300">Michelson-native</span> (your tz1 signs) — the op-group calls the EVM-side
            router via <span className="font-mono text-slate-300">call_evm</span> as your{' '}
            <span className="text-slate-300">evm alias</span>; the swap’s native-XTZ output auto-forwards to your tz1,
            which then funds a Michelson op (e.g. the marketplace fulfill). One atomic, single-signature group.
          </li>
          <li>
            <span className="text-slate-300">EVM-native</span> (your 0x signs) — the{' '}
            <span className="font-mono text-slate-300">/swap</span> response is a raw EVM tx you send directly; to reach a
            Michelson contract you call <span className="font-mono text-slate-300">callMichelson</span> on the gateway as
            your <span className="text-slate-300">michelson alias</span> (a KT1), so the NFT lands there. A wallet batches
            approve + swap + fulfill via EIP-5792, or sends them sequentially.
          </li>
        </ul>
        <p className="mt-2 text-sm text-slate-400">Either way the SDK only prepares the ops — you sign and broadcast with your own wallet.</p>
      </div>

      {/* server-side reads (BFF) */}
      <div className="card">
        <div className="label mb-2">Keeping the API key server-side</div>
        <p className="text-sm text-slate-400">
          For brevity the per-page samples build the client inline. A real dApp — this one included — keeps the keyed
          free-route reads on its own server and proxies them, so the API key never reaches the browser. The SDK ships the
          pieces for exactly this split: a reads-only <span className="font-mono text-slate-300">FreeRouteClient</span> for
          the server, <span className="font-mono text-slate-300">serialize*</span> /{' '}
          <span className="font-mono text-slate-300">parse*</span> DTO helpers so quotes and swaps cross the HTTP boundary
          without losing their bigint fields, and a <span className="font-mono text-slate-300">FreeRouteApi</span>{' '}
          interface the browser implements as a thin, keyless client over those endpoints. The gateway-bound op builders
          (<span className="font-mono text-slate-300">createMichelsonOpsBuilder</span> /{' '}
          <span className="font-mono text-slate-300">createEvmOpsBuilder</span>) then turn those keyless reads into
          ready-to-sign ops in the browser — see the tail of the Client sample.{' '}
          <a
            className="text-accent hover:underline"
            href="https://github.com/3route/free-route-tezos-x-example/tree/main/app/api/free-route"
            target="_blank"
            rel="noreferrer"
          >
            See the source
          </a>
          .
        </p>
        <p className="mt-2 text-xs text-slate-500">
          The per-page samples use the bundled facade (<span className="font-mono text-slate-400">FreeRouteTezosX</span>,
          one place holds the key) for brevity. This app uses the split above — keyed{' '}
          <span className="font-mono text-slate-400">FreeRouteClient</span> on the server, keyless reads + builders on the
          client. The SDK README covers all three tiers (facade · client+builder split · low-level builders).
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <div className="label mb-1.5">Server</div>
            <CodeBlock html={serverHtml} code={SERVER_CODE} />
          </div>
          <div>
            <div className="label mb-1.5">Client</div>
            <CodeBlock html={clientHtml} code={CLIENT_CODE} />
          </div>
        </div>
      </div>

      {/* pages */}
      <div className="space-y-4">
        <h2 className="px-1 text-sm font-semibold text-slate-300">Pages</h2>
        {PAGES.map((p) => (
          <div key={p.href} className="card">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-semibold">{p.title}</h3>
              <a className="font-mono text-xs text-accent hover:underline" href={p.href}>
                {p.href}
              </a>
            </div>
            <p className="mt-2 text-sm text-slate-400">{p.blurb}</p>
            {p.code && (
              <div className="mt-3">
                <div className="label mb-1.5">Example</div>
                <CodeBlock html={codeHtml[p.href]} code={p.code} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* EVM (MetaMask) — the mirror, after the buy/sell pages */}
      <div className="card">
        <div className="label mb-2">EVM (MetaMask) — the same buy, native txs</div>
        <p className="text-sm text-slate-400">
          From a native EVM account the builders return an <span className="font-mono text-slate-300">EvmTxRequest[]</span>{' '}
          batch — <span className="font-mono text-slate-300">approve + swap</span> on the router, then the marketplace
          fulfill via <span className="font-mono text-slate-300">callMichelson</span>. The NFT lands on the account’s KT1
          alias. Send it with one EIP-5792 <span className="font-mono text-slate-300">wallet_sendCalls</span> (or
          sequentially where unsupported).
        </p>
        <div className="mt-3">
          <CodeBlock html={evmHtml} code={EVM_BUYER_CODE} />
        </div>
      </div>

      <p className="px-1 text-xs text-slate-600">Running on Tezos X previewnet.</p>
    </div>
  );
}
