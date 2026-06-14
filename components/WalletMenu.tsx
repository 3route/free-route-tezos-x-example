'use client';
import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { BALANCES_REFRESH_MS, useBalances, useTokens } from '@/lib/hooks';
import { fmtUnits, short } from '@/lib/format';
import { CFG } from '@/lib/config';

const tzktLink = (a: string) => `${CFG.explorer}/${a}`;
const evmLink = (a: string) => `${CFG.evmExplorer}/address/${a}`;

// Tiny copy-to-clipboard button (shows a check for ~1.2s after copying).
function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="shrink-0 text-slate-500 hover:text-slate-300"
      title="copy"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

// Header wallet control: Connect button when disconnected; otherwise an address pill that opens a
// dropdown with balances + a Disconnect button.
export function WalletMenu() {
  const { connected, michelsonAddress, aliasAddress, connect, switchAccount, disconnect, connecting } = useWallet();
  const { payTokens } = useTokens();
  const { xtz, erc, loading, updatedAt, refresh } = useBalances();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 1s tick for the "updating in Ns" countdown — only while the dropdown is open
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);
  const refreshInSec = updatedAt ? Math.max(0, Math.round(BALANCES_REFRESH_MS / 1000) - Math.round((now - updatedAt) / 1000)) : null;

  if (!connected) {
    return (
      <button className="btn-primary" onClick={() => void connect()} disabled={connecting}>
        {connecting ? 'Connecting…' : 'Connect Temple'}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>
        <span className="h-2 w-2 rounded-full bg-accent2" />
        <span className="font-mono">{short(michelsonAddress ?? '')}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-72 rounded-xl border border-edge bg-panel p-3 shadow-xl shadow-black/50">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Balances</span>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {loading ? <span>updating…</span> : refreshInSec !== null && <span>updating in {refreshInSec}s</span>}
              <button className="hover:text-slate-300" onClick={() => void refresh()} title="refresh">
                ↻
              </button>
            </div>
          </div>

          <div className="text-xs">
            {/* Michelson side — native XTZ on the tz1 address (header carries the address) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-slate-600">Michelson</span>
                <div className="flex items-center gap-1.5">
                  <a href={tzktLink(michelsonAddress ?? '')} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-accent hover:underline" title={michelsonAddress ?? ''}>
                    {short(michelsonAddress ?? '', 6)}
                  </a>
                  <CopyButton value={michelsonAddress ?? ''} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">XTZ</span>
                <span className="font-mono">{xtz === null ? '…' : fmtUnits(xtz, 6, 6)}</span>
              </div>
            </div>
            {/* EVM side — ERC20s held by the alias (header carries the alias address) */}
            <div className="mt-3 space-y-1.5 border-t border-edge pt-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-slate-600">EVM alias</span>
                <div className="flex items-center gap-1.5">
                  <a href={evmLink(aliasAddress ?? '')} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-accent hover:underline" title={aliasAddress ?? ''}>
                    {short(aliasAddress ?? '', 6)}
                  </a>
                  <CopyButton value={aliasAddress ?? ''} />
                </div>
              </div>
              {payTokens.map((t) => (
                <div key={t.address} className="flex items-center justify-between">
                  <span className="text-slate-400">{t.symbol}</span>
                  <span className="font-mono">{erc[t.address] === undefined ? '…' : fmtUnits(erc[t.address] ?? 0n, t.decimals, t.decimals)}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            className="btn-ghost mt-3 w-full"
            disabled={connecting}
            onClick={() => {
              setOpen(false);
              void switchAccount();
            }}
          >
            {connecting ? 'Switching…' : 'Switch account'}
          </button>
          <button
            className="btn-ghost mt-2 w-full text-rose-300 hover:bg-rose-500/10"
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
