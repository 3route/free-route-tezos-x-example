'use client';
import { useEffect, useState } from 'react';
import type { ParamsWithKind } from '@taquito/taquito';
import { useWallet } from '@/lib/wallet';
import { useUi } from '@/lib/ui';
import { useBalances } from '@/lib/hooks';
import { buildSwapBatch, sendWalletGroup, type SwapDetails } from '@/lib/ops';
import { isXtz } from '@/lib/sdk';
import type { FreeRouteToken } from '@/lib/sdk';
import { fmtUnits } from '@/lib/format';
import { useHistory } from '@/lib/history';
import { fetchErc20Balance, fetchXtzBalance } from '@/lib/tzkt';
import { buildSwapReceipt, type SwapReceipt } from '@/lib/receipt';
import { SwapReceiptModal } from './SwapReceiptModal';

const Spinner = () => <div className="h-6 w-6 animate-spin rounded-full border-2 border-edge border-t-accent" />;

const SLIPPAGES = [
  { label: '0.1%', bps: 10 },
  { label: '0.5%', bps: 50 },
  { label: '1%', bps: 100 },
];
const MIN_SLIPPAGE_BPS = 0;
const MAX_SLIPPAGE_BPS = 4900;

export function BridgeModal({ src, dst, amount, onClose }: { src: FreeRouteToken; dst: FreeRouteToken; amount: bigint; onClose: () => void }) {
  const { tezos, michelsonAddress, aliasAddress } = useWallet();
  const refresh = useUi((s) => s.refresh);
  const addSwap = useHistory((s) => s.addSwap);
  const { xtz, erc } = useBalances();
  const slippageBps = useUi((s) => s.slippageBps);
  const setSlippageBps = useUi((s) => s.setSlippageBps);
  const [customSlippage, setCustomSlippage] = useState(() => (SLIPPAGES.some((s) => s.bps === slippageBps) ? '' : String(slippageBps / 100)));

  const [details, setDetails] = useState<SwapDetails | null>(null);
  const [ops, setOps] = useState<ParamsWithKind[] | null>(null);
  const [receipt, setReceipt] = useState<SwapReceipt | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finalizing, setFinalizing] = useState(false); // tx sent, building the on-chain receipt
  const [err, setErr] = useState<string | null>(null);
  const [quotedAt, setQuotedAt] = useState<number | null>(null);

  // (re)quote on slippage change, and auto-refresh every 30s
  useEffect(() => {
    if (!michelsonAddress) return;
    let cancelled = false;
    const requote = () => {
      setQuoting(true);
      setErr(null);
      setOps(null); // never send stale ops mid-requote
      buildSwapBatch(michelsonAddress, src, dst, amount, slippageBps)
        .then(({ ops: o, details: d }) => {
          if (!cancelled) {
            setOps(o);
            setDetails(d);
            setQuotedAt(Date.now());
          }
        })
        .catch((e: Error) => {
          if (!cancelled) {
            setErr(e.message);
            setDetails(null);
          }
        })
        .finally(() => !cancelled && setQuoting(false));
    };
    requote();
    const id = setInterval(requote, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [michelsonAddress, src, dst, amount, slippageBps]);

  // 1s tick for the "updating in Ns" countdown
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const refreshInSec = quotedAt ? Math.max(0, 30 - Math.round((now - quotedAt) / 1000)) : null;

  const bal = isXtz(src.address) ? xtz ?? 0n : erc[src.address] ?? 0n;
  const enough = bal >= amount;
  const landing = isXtz(dst.address) ? 'auto-forwards to your Michelson address' : 'received on your EVM alias';

  async function confirm() {
    if (!tezos || !ops || !michelsonAddress || !aliasAddress || !details) return;
    setBusy(true);
    setErr(null);
    try {
      // snapshot real balances BEFORE (live node reads) so the receipt is measured, not estimated
      const [bxtz, bsrc, bdst] = await Promise.all([
        fetchXtzBalance(michelsonAddress),
        isXtz(src.address) ? Promise.resolve(0n) : fetchErc20Balance(src.address, aliasAddress),
        isXtz(dst.address) ? Promise.resolve(0n) : fetchErc20Balance(dst.address, aliasAddress),
      ]);
      const before = { xtz: bxtz, src: isXtz(src.address) ? bxtz : bsrc, dst: isXtz(dst.address) ? bxtz : bdst };
      const hash = await sendWalletGroup(tezos, ops);
      setFinalizing(true);
      refresh();
      try {
        const r = await buildSwapReceipt({ opHash: hash, account: michelsonAddress, aliasAddress, src, dst, quotedPay: details.payAmount, minOut: details.minOut, before });
        addSwap(r); // record in the activity log
        setReceipt(r);
      } catch {
        onClose(); // receipt unavailable (indexer lag) — the swap itself still succeeded
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setFinalizing(false);
    }
  }

  if (receipt) return <SwapReceiptModal receipt={receipt} onClose={onClose} />;

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-lg text-accent">⇄</div>
          <div className="min-w-0">
            <div className="font-semibold">
              Swap {src.symbol} → {dst.symbol}
            </div>
            <div className="font-mono text-[11px] text-slate-500">
              You pay {fmtUnits(amount, src.decimals, src.decimals)} {src.symbol}
            </div>
          </div>
        </div>

        {/* slippage */}
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">Slippage</span>
            {SLIPPAGES.map((s) => (
              <button
                key={s.bps}
                onClick={() => {
                  setSlippageBps(s.bps);
                  setCustomSlippage('');
                }}
                className={`chip ${!customSlippage && slippageBps === s.bps ? 'border-accent text-accent' : ''}`}
              >
                {s.label}
              </button>
            ))}
            <span className={`chip gap-1 ${customSlippage ? 'border-accent text-accent' : ''}`}>
              <input
                type="number"
                step="0.1"
                min={MIN_SLIPPAGE_BPS / 100}
                max={MAX_SLIPPAGE_BPS / 100}
                placeholder="custom"
                value={customSlippage}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setCustomSlippage('');
                    return;
                  }
                  let pct = Number(raw);
                  if (!Number.isFinite(pct) || pct < 0) return;
                  const maxPct = MAX_SLIPPAGE_BPS / 100;
                  const text = pct > maxPct ? ((pct = maxPct), String(maxPct)) : raw;
                  setCustomSlippage(text);
                  setSlippageBps(Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.round(pct * 100))));
                }}
                className="w-14 bg-transparent text-right outline-hidden [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              %
            </span>
          </div>
          {slippageBps > 500 && <p className="mt-1.5 text-[11px] text-amber-400">High slippage — you may overpay.</p>}
          {slippageBps < 10 && <p className="mt-1.5 text-[11px] text-amber-400">Very low — the swap may revert on a thin pool.</p>}
          <p className="mt-1.5 text-[11px] text-slate-500">quote via free-route{refreshInSec !== null ? ` · updating in ${refreshInSec}s` : ''}</p>
        </div>

        {/* review */}
        <div className="text-sm">
          <div className="relative min-h-52">
            {err && !details && <div className="grid h-52 place-items-center text-center text-xs text-rose-400">{err}</div>}
            {details && (
              <div className={`space-y-3 transition-opacity ${quoting ? 'opacity-40' : 'opacity-100'}`}>
                {/* You pay */}
                <div className="rounded-lg border border-edge p-2.5">
                  <div className="label mb-1.5">You pay</div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">
                      Amount <span className="text-[10px] uppercase tracking-wide text-slate-600">exact</span>
                    </span>
                    <span className="font-mono">
                      {fmtUnits(details.payAmount, src.decimals, src.decimals)} {src.symbol}
                    </span>
                  </div>
                </div>

                {/* You receive */}
                <div className="rounded-lg border border-edge p-2.5">
                  <div className="label mb-1.5">You receive</div>
                  <div className="flex items-start justify-between">
                    <span className="text-slate-400">{dst.symbol}</span>
                    <span className="text-right font-mono">
                      <span className="block">
                        ≈ {fmtUnits(details.expectedOut, dst.decimals, dst.decimals)} {dst.symbol}{' '}
                        <span className="text-[10px] uppercase tracking-wide text-slate-600">expected</span>
                      </span>
                      <span className="block text-xs text-slate-500">
                        ≥ {fmtUnits(details.minOut, dst.decimals, dst.decimals)} {dst.symbol} guaranteed
                      </span>
                      <span className="block text-[11px] text-slate-600">{landing}</span>
                    </span>
                  </div>
                </div>

                {/* steps */}
                <div className="rounded-lg border border-edge p-2.5">
                  <div className="label mb-1.5">One signature · atomic op-group</div>
                  <ol className="space-y-1 text-xs text-slate-400">
                    {details.steps.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-3 shrink-0 text-right tabular-nums text-slate-600">{i + 1}.</span>
                        <span>
                          <span className="text-slate-300">{s.kind}</span> — {s.detail}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>

                {!enough && (
                  <div className="text-xs text-amber-400">
                    Balance ({fmtUnits(bal, src.decimals, src.decimals)} {src.symbol}) is below the amount.
                  </div>
                )}
              </div>
            )}
            {quoting && (
              <div className="absolute inset-0 grid place-items-center">
                <Spinner />
              </div>
            )}
          </div>
        </div>

        {err && details && <p className="mt-3 text-xs text-rose-400">{err}</p>}

        {/* actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void confirm()} disabled={!ops || busy || quoting || !enough}>
            {busy ? (finalizing ? 'Finalizing…' : 'Signing…') : `Swap → ${dst.symbol}`}
          </button>
        </div>
      </div>
    </div>
  );
}
