import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: '3Route Tezos X · SDK demo',
  description:
    'Reference dApp for @baking-bad/free-route-tezos-x — pay any ERC20 for XTZ-priced assets or swap any token, in one atomic op-group.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
