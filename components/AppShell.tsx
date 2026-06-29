'use client';
import { useEffect, type ReactNode } from 'react';
import { Header } from './Header';
import { LogPanel } from './LogPanel';
import { useWallet } from '@/lib/wallet';
import { useEvmWallet } from '@/lib/evmWallet';
import { useActiveWallet } from '@/lib/account';
import { useActiveKind } from '@/lib/activeKind';
import { useBalancesSync, useTokens } from '@/lib/hooks';

// Shared chrome around every route: header (nav + wallet), the activity log aside, and the one-time wallet
// restore + the single balances poll mount. The route page renders into the main section.
export function AppShell({ children }: { children: ReactNode }) {
  const restoreTemple = useWallet((s) => s.restore);
  const restoreEvm = useEvmWallet((s) => s.restore);
  const lastKind = useActiveKind((s) => s.lastKind);
  const aw = useActiveWallet();
  const { payTokens } = useTokens();
  useBalancesSync(aw.kind, aw.evmPayer, aw.michelsonOwner, payTokens);
  // Restore ONLY the wallet the user last actively used. Restoring both lets a persisted Beacon (Temple) session
  // steal priority from MetaMask. `lastKind` is set on explicit connect, cleared on disconnect (lib/activeKind).
  useEffect(() => {
    if (lastKind === 'metamask') void restoreEvm();
    else if (lastKind === 'temple') void restoreTemple();
  }, [lastKind, restoreTemple, restoreEvm]);

  return (
    <>
      {/* testnet banner — pinned at the very top, scrolls away under the sticky header */}
      <div className="border-b border-amber-500/20 bg-amber-500/10 py-1 text-center text-[11px] font-medium tracking-wide text-amber-300">
        previewnet · Tezos X test network — tokens have no real value
      </div>
      <Header />
      <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0">{children}</section>
        <aside className="h-[70vh] lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
          <LogPanel />
        </aside>
      </main>
    </>
  );
}
