'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletMenu } from './WalletMenu';

const MODES = [
  { href: '/buyer', label: 'Buyer' },
  { href: '/seller', label: 'Seller' },
  { href: '/owned', label: 'My NFTs' },
  { href: '/bridge', label: 'Bridge' },
];

const APP_REPO = 'https://github.com/3route/free-route-tezos-x-example';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-edge bg-ink/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/20 text-accent">◈</div>
          <div>
            <div className="text-sm font-semibold leading-tight">3Route Tezos X · SDK demo</div>
            <div className="text-[11px] text-slate-500">previewnet · one atomic op-group</div>
          </div>
        </div>

        {/* mode toggle — real routes */}
        <div className="flex rounded-xl border border-edge p-0.5">
          {MODES.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm transition ${
                pathname === m.href ? 'bg-accent text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/docs"
            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              pathname === '/docs' ? 'border-accent bg-accent/15 text-white' : 'border-edge text-slate-300 hover:bg-white/5'
            }`}
          >
            Docs
          </Link>
          <a
            href={APP_REPO}
            target="_blank"
            rel="noreferrer"
            title="This app’s source on GitHub"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
          >
            <GitHubIcon />
          </a>
          <WalletMenu />
        </div>
      </div>
    </header>
  );
}
