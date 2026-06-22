'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletMenu } from './WalletMenu';

const MODES = [
  { href: '/', label: 'Buyer' },
  { href: '/seller', label: 'Seller' },
  { href: '/owned', label: 'My NFTs' },
  { href: '/bridge', label: 'Bridge' },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-edge bg-ink/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/20 text-accent">◈</div>
          <div>
            <div className="text-sm font-semibold leading-tight">objkt · pay with any ERC20</div>
            <div className="text-[11px] text-slate-500">Tezos X previewnet · one atomic op-group</div>
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

        <div className="ml-auto">
          <WalletMenu />
        </div>
      </div>
    </header>
  );
}
