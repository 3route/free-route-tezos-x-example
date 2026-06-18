'use client';
import { useEffect, useMemo, useState } from 'react';
import { useBalances, useTokens } from '@/lib/hooks';
import { useWallet } from '@/lib/wallet';
import { useUi } from '@/lib/ui';
import { XTZ, XTZ_ADDRESS, fromEvm, isXtz, freeRoute, toEvm } from '@/lib/sdk';
import type { FreeRouteToken } from '@/lib/sdk';
import { fmtUnits, parseUnits } from '@/lib/format';
import { CFG } from '@/lib/config';
import { BridgeModal } from './BridgeModal';

const XTZ_FEE_BUFFER = 50_000n; // mutez left for op fees when "Max"-ing an XTZ swap
const QUOTE_REFRESH_MS = 30_000; // auto-refresh the To preview, like the buy/bridge modal

export function BridgePanel() {
  const { connected, michelsonAddress, connect } = useWallet();
  const { payTokens } = useTokens();
  const { xtz, erc } = useBalances();

  const tokens = useMemo<FreeRouteToken[]>(() => [XTZ, ...payTokens], [payTokens]);
  const [fromAddr, setFromAddr] = useState(XTZ_ADDRESS);
  const [toAddr, setToAddr] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [open, setOpen] = useState(false);
  const [outPreview, setOutPreview] = useState<bigint | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const slippageBps = useUi((s) => s.slippageBps);
  const bump = useUi((s) => s.bump); // bumped by refresh() after a swap/buy — re-quote (liquidity moved)

  // default To to USDC (fall back to the first ERC20) once the registry loads
  useEffect(() => {
    if (!toAddr && payTokens.length) setToAddr((payTokens.find((t) => t.symbol === 'USDC') ?? payTokens[0]).address);
  }, [toAddr, payTokens]);

  const byAddr = (a: string) => tokens.find((t) => t.address === a) ?? null;
  const fromTok = byAddr(fromAddr);
  const toTok = byAddr(toAddr);
  const balanceOf = (t: FreeRouteToken): bigint => (isXtz(t.address) ? xtz ?? 0n : erc[t.address] ?? 0n);
  const amountBase = fromTok ? parseUnits(amountStr, fromTok.decimals) : null;
  const insufficient = amountBase !== null && fromTok ? amountBase > balanceOf(fromTok) : false;
  const samePair = fromAddr === toAddr;
  const lowXtz = xtz !== null && xtz < 1_000_000n; // < 1 XTZ — nudge the user to the faucet

  // live output preview in the To field — pricing-only getQuote (no calldata/approval); works before connecting.
  // re-quotes on input change (debounced) AND every QUOTE_REFRESH_MS so the estimate stays fresh.
  useEffect(() => {
    if (!fromTok || !toTok || samePair || amountBase === null || amountBase <= 0n) {
      setOutPreview(null);
      setPreviewAt(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setPreviewing(true);
      try {
        const q = await freeRoute.getQuote({ src: fromTok.address, dst: toTok.address, amount: toEvm(amountBase, fromTok.address) });
        if (!cancelled) {
          setOutPreview(fromEvm(q.dstAmount, toTok.address));
          setPreviewAt(Date.now());
        }
      } catch {
        if (!cancelled) setOutPreview(null);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    };
    const debounce = setTimeout(run, 400);
    const interval = setInterval(run, QUOTE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAddr, toAddr, amountStr, slippageBps, bump]);

  // 1s tick for the "updating in Ns" countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const refreshInSec = previewAt ? Math.max(0, Math.round(QUOTE_REFRESH_MS / 1000) - Math.round((now - previewAt) / 1000)) : null;
  const canReview = connected && !!fromTok && !!toTok && amountBase !== null && amountBase > 0n && !samePair && !insufficient;

  const pickFrom = (a: string) => {
    if (a === toAddr) setToAddr(fromAddr);
    setFromAddr(a);
  };
  const pickTo = (a: string) => {
    if (a === fromAddr) setFromAddr(toAddr);
    setToAddr(a);
  };
  const flip = () => {
    setFromAddr(toAddr);
    setToAddr(fromAddr);
    setAmountStr('');
  };
  const setMax = () => {
    if (!fromTok) return;
    const bal = balanceOf(fromTok);
    const buf = isXtz(fromTok.address) ? XTZ_FEE_BUFFER : 0n;
    setAmountStr(fmtUnits(bal > buf ? bal - buf : 0n, fromTok.decimals, fromTok.decimals));
  };

  const tokenSelect = (value: string, onChange: (a: string) => void) => (
    <select className="input w-28 cursor-pointer" value={value} onChange={(e) => onChange(e.target.value)}>
      {tokens.map((t) => (
        <option key={t.address} value={t.address}>
          {t.symbol}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Bridge · swap balance</h2>
        <a href={CFG.faucet} target="_blank" rel="noreferrer" className={`btn-ghost text-xs ${lowXtz ? 'animate-pulse border-accent text-accent' : ''}`}>
          Get XTZ ↗
        </a>
      </div>

      <div className="card space-y-3">
        {/* From */}
        <div className="rounded-xl border border-edge bg-ink/40 p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
            <span className="label">From</span>
            {fromTok && (
              <button className="hover:text-slate-300" onClick={setMax}>
                balance {fmtUnits(balanceOf(fromTok), fromTok.decimals, fromTok.decimals)} · Max
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 font-mono text-lg"
              inputMode="decimal"
              placeholder="0.0"
              value={amountStr}
              onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmountStr(e.target.value)}
            />
            {tokenSelect(fromAddr, pickFrom)}
          </div>
        </div>

        {/* flip */}
        <div className="flex justify-center">
          <button className="btn-ghost h-8 w-8 rounded-full p-0" onClick={flip} title="flip">
            ⇅
          </button>
        </div>

        {/* To */}
        <div className="rounded-xl border border-edge bg-ink/40 p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
            <span className="label">To</span>
            {toTok && <span>balance {fmtUnits(balanceOf(toTok), toTok.decimals, toTok.decimals)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 truncate font-mono text-lg text-slate-300">
              {previewing ? '…' : outPreview !== null && toTok ? `≈ ${fmtUnits(outPreview, toTok.decimals, toTok.decimals)}` : '0.0'}
            </div>
            {tokenSelect(toAddr, pickTo)}
          </div>
        </div>

        {(previewing || refreshInSec !== null) && (
          <p className="text-[11px] text-slate-500">quote via free-route{previewing ? ' · updating…' : ` · updating in ${refreshInSec}s`}</p>
        )}

        {insufficient && <div className="text-xs text-amber-400">Insufficient {fromTok?.symbol} balance.</div>}

        {connected ? (
          <button className="btn-primary w-full" disabled={!canReview} onClick={() => setOpen(true)}>
            {samePair ? 'Pick two different tokens' : 'Review swap'}
          </button>
        ) : (
          <button className="btn-primary w-full" onClick={() => void connect()}>
            Connect Temple
          </button>
        )}
      </div>

      {open && fromTok && toTok && amountBase !== null && (
        <BridgeModal src={fromTok} dst={toTok} amount={amountBase} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
