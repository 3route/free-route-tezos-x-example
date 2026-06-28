'use client';
import { useEffect, useRef, useState } from 'react';
import { useActiveWallet } from '@/lib/account';
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

// One labeled address row (explorer link + copy).
function AddrRow({ label, address, evm }: { label: string; address: string; evm?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[11px] text-slate-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <a href={(evm ? evmLink : tzktLink)(address)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-accent hover:underline" title={address}>
          {short(address, 6)}
        </a>
        <CopyButton value={address} />
      </div>
    </div>
  );
}

// Header wallet control: a wallet picker when disconnected; otherwise an address pill that opens a dropdown
// with balances + Disconnect. Two signing directions: Temple (Michelson) and MetaMask (EVM).
export function WalletMenu() {
  const aw = useActiveWallet();
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

  // ── disconnected: pick a wallet ──
  if (!aw.connected) {
    return (
      <div className="relative" ref={ref}>
        <button className="btn-primary" onClick={() => setOpen((o) => !o)} disabled={aw.connecting}>
          {aw.connecting ? 'Connecting…' : 'Connect wallet'}
        </button>
        {open && (
          <div className="absolute right-0 z-30 mt-1.5 w-56 rounded-xl border border-edge bg-panel p-2 shadow-xl shadow-black/50">
            <button
              className="btn-ghost w-full justify-between"
              onClick={() => {
                setOpen(false);
                void aw.temple.connect();
              }}
            >
              Temple <span className="text-[10px] text-slate-500">Michelson</span>
            </button>
            <button
              className="btn-ghost mt-1 w-full justify-between"
              onClick={() => {
                setOpen(false);
                void aw.evm.connect().catch(() => undefined);
              }}
            >
              MetaMask <span className="text-[10px] text-slate-500">EVM</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  const isEvm = aw.kind === 'metamask';
  const tokensRows = payTokens.map((t) => (
    <div key={t.address} className="flex items-center justify-between">
      <span className="text-slate-400">{t.symbol}</span>
      <span className="font-mono">{erc[t.address] === undefined ? '…' : fmtUnits(erc[t.address] ?? 0n, t.decimals, t.decimals)}</span>
    </div>
  ));

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>
        <span className="h-2 w-2 rounded-full bg-accent2" />
        <span className="text-[10px] tracking-wide text-slate-500">{isEvm ? 'evm' : 'michelson'}</span>
        <span className="font-mono">{short(aw.displayAddress ?? '')}</span>
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
            {isEvm ? (
              <>
                {/* EVM account — holds the ERC20s + native XTZ (gas) */}
                <div className="space-y-1.5">
                  <AddrRow label="evm account" address={aw.evm.evmAddress ?? ''} evm />
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">XTZ (gas)</span>
                    <span className="font-mono">{xtz === null ? '…' : fmtUnits(xtz, 6, 6)}</span>
                  </div>
                  {tokensRows}
                </div>
                {/* Michelson alias (KT1) — where bought/minted NFTs land */}
                <div className="mt-3 space-y-1.5 border-t border-edge pt-3">
                  <AddrRow label="michelson alias" address={aw.evm.aliasAddress ?? ''} />
                </div>
              </>
            ) : (
              <>
                {/* Michelson account — native XTZ */}
                <div className="space-y-1.5">
                  <AddrRow label="michelson account" address={aw.temple.michelsonAddress ?? ''} />
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">XTZ</span>
                    <span className="font-mono">{xtz === null ? '…' : fmtUnits(xtz, 6, 6)}</span>
                  </div>
                </div>
                {/* EVM alias — holds the ERC20s */}
                <div className="mt-3 space-y-1.5 border-t border-edge pt-3">
                  <AddrRow label="evm alias" address={aw.temple.aliasAddress ?? ''} evm />
                  {tokensRows}
                </div>
              </>
            )}
          </div>

          {(() => {
            const switching = isEvm ? aw.evm.connecting : aw.temple.connecting;
            return (
              <button
                className="btn-ghost mt-3 w-full"
                disabled={switching}
                onClick={() => {
                  setOpen(false);
                  if (isEvm) void aw.evm.switchAccount().catch(() => undefined);
                  else void aw.temple.switchAccount();
                }}
              >
                {switching ? 'Switching…' : 'Switch account'}
              </button>
            );
          })()}
          <button
            className="btn-ghost mt-2 w-full text-rose-300 hover:bg-rose-500/10"
            onClick={() => {
              setOpen(false);
              aw.disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
