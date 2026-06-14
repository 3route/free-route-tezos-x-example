'use client';
import { useEffect, type ReactNode } from 'react';
import { Header } from './Header';
import { LogPanel } from './LogPanel';
import { useWallet } from '@/lib/wallet';
import { useBalancesSync, useTokens } from '@/lib/hooks';

// Shared chrome around every route: header (nav + wallet), the activity log aside, and the one-time wallet
// restore + the single balances poll mount. The route page renders into the main section.
export function AppShell({ children }: { children: ReactNode }) {
  const restore = useWallet((s) => s.restore);
  const { michelsonAddress, aliasAddress } = useWallet();
  const { payTokens } = useTokens();
  useBalancesSync(aliasAddress, michelsonAddress, payTokens);
  useEffect(() => {
    void restore(); // rehydrate an existing Temple session after a reload
  }, [restore]);

  return (
    <>
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
