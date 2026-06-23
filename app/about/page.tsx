// /about — what this demo is and how the package API is used. Static content; shell from AppShell.
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
  FreeRouteTezosX, tezosXMainnet, XTZ, toEvm, targetForMinOut,
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
const swap = await freeRoute.getSwap({
  src: payToken.address,
  dst: XTZ.address,
  amount: toEvm(minOutTarget, XTZ.address),
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
const swapOps = freeRoute.buildSwapOperation({ swap, srcAddress: payToken.address, approval });
const fulfill = objkt.buildFulfillAsk({
  marketplace: OBJKT_MARKETPLACE,
  askId: '1',
  editions: 1,
  amountMutez: priceMutez,
});

const ops = buildBatchTransaction(swapOps, fulfill);
const op = await tezos.contract.batch().with(ops).send(); // a single signature
await op.confirmation();`;

const BRIDGE_CODE = `import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import {
  FreeRouteTezosX, tezosXMainnet, XTZ, toEvm, isXtz,
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
const swap = await freeRoute.getSwap({
  src: src.address,
  dst: dst.address,
  amount: toEvm(amount, src.address),
  isExactOut: false,
  from: alias,
  receiver: alias,
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
const ops = freeRoute.buildSwapOperation({ swap, srcAddress: src.address, approval });
const op = await tezos.contract.batch().with(ops).send(); // a single signature
await op.confirmation();`;

const PAGES: PageDoc[] = [
  {
    title: 'Buyer',
    href: '/buyer',
    blurb:
      'Pay any EVM ERC20 for an XTZ-priced objkt NFT in one atomic, single-signature op-group. The swap output (native XTZ) auto-forwards to the buyer’s Michelson address and funds the marketplace fulfill.',
    code: BUYER_CODE,
  },
  {
    title: 'Bridge',
    href: '/bridge',
    blurb:
      'A standalone swap of any token to any token (XTZ ↔ ERC20, ERC20 ↔ ERC20), exact-input. The same builders as the buy, minus the marketplace op.',
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
    blurb: 'A read-only view of the NFTs the connected Michelson address owns from the test collection — confirms a completed buy.',
  },
];

export default async function AboutPage() {
  // highlight each sample server-side (shiki) — pre-rendered HTML, no client JS
  const codeHtml: Record<string, string> = Object.fromEntries(
    await Promise.all(
      PAGES.filter((p) => p.code).map(
        async (p) => [p.href, await codeToHtml(p.code as string, { lang: 'ts', theme: 'github-dark' })] as const,
      ),
    ),
  );

  return (
    <div className="space-y-5">
      {/* intro */}
      <div className="card">
        <h1 className="text-lg font-semibold">About this demo</h1>
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
          (e.g. an objkt NFT), composed into a single atomic op-group and signed once from the Michelson side.
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
          Tezos X exposes both a Michelson (Tezlink) and an EVM (Etherlink) interface, bridged by{' '}
          <span className="font-mono text-slate-300">call_evm</span>. The SDK builds Michelson ops that call the EVM-side
          free-route router — an ERC20 → XTZ swap (with the right approvals) whose native-XTZ output auto-forwards to
          your Michelson account, which can then fund another Michelson op (e.g. a marketplace purchase). It only
          prepares the ops — you sign and broadcast with your own Taquito toolkit.
        </p>
      </div>

      {/* per-page */}
      <div className="space-y-4">
        <h2 className="px-1 text-sm font-semibold text-slate-300">What each page demonstrates</h2>
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

      <p className="px-1 text-xs text-slate-600">
        Reads (<span className="font-mono">getTokens</span> / <span className="font-mono">getQuote</span> /{' '}
        <span className="font-mono">getSwap</span>) are proxied through this app&apos;s server route so an API key stays
        off the client; the op-builders run in the browser. Running on Tezos X previewnet.
      </p>
    </div>
  );
}
