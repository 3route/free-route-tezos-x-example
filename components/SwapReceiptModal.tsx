'use client';
import { fmtUnits } from '@/lib/format';
import { isXtz } from '@/lib/sdk';
import { CFG } from '@/lib/config';
import type { SwapReceipt } from '@/lib/receipt';

const amt = (v: bigint, decimals: number, sym: string) => `${fmtUnits(v, decimals, decimals)} ${sym}`;

function Line({ label, sub, value, tone }: { label: string; sub?: string; value: string; tone?: 'emerald' | 'muted' }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-400">
        {label}
        {sub && <span className="block text-[11px] text-slate-600">{sub}</span>}
      </span>
      <span className={`shrink-0 font-mono ${tone === 'emerald' ? 'text-emerald-400' : tone === 'muted' ? 'text-slate-500' : ''}`}>{value}</span>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex gap-2 ${ok ? 'text-slate-400' : 'text-rose-400'}`}>
      <span>{ok ? '✓' : '✗'}</span>
      <span>{children}</span>
    </li>
  );
}

export function SwapReceiptModal({ receipt: r, onClose }: { receipt: SwapReceipt; onClose: () => void }) {
  const { src, dst } = r;
  const srcXtz = isXtz(src.address);
  const dstXtz = isXtz(dst.address);
  // op fee is paid in XTZ — show it on whichever side is XTZ so that box reconciles (ERC20↔ERC20: its own line).
  const feeLine = <Line label="Network fee" sub="actual paid fee · Σ bakerFee" value={`−${fmtUnits(r.networkFee, 6, 6)} XTZ`} tone="muted" />;
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500/15 text-lg text-emerald-400">✓</div>
          <div className="min-w-0">
            <div className="font-semibold">Swap complete</div>
            <div className="truncate text-xs text-slate-500">
              {src.symbol} → {dst.symbol} ·{' '}
              <a className="text-accent hover:underline" href={`${CFG.explorer}/${r.opHash}`} target="_blank" rel="noreferrer">
                view on tzkt ↗
              </a>
            </div>
          </div>
        </div>

        {/* paid — measured */}
        <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">
          <div className="label mb-2">You paid</div>
          <div className="space-y-1.5">
            <Line label={`${src.symbol} spent`} value={`−${amt(r.srcSpent, src.decimals, src.symbol)}`} />
            <div className="flex justify-between font-mono text-xs text-slate-500">
              <span className="font-sans text-slate-600">{src.symbol} balance</span>
              <span>{fmtUnits(r.srcBefore, src.decimals, src.decimals)} → {fmtUnits(r.srcAfter, src.decimals, src.decimals)}</span>
            </div>
            {srcXtz && <div className="border-t border-edge pt-1.5">{feeLine}</div>}
          </div>
        </div>

        {/* received — measured */}
        <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">
          <div className="label mb-2">You received</div>
          <div className="space-y-1.5">
            <Line label={`${dst.symbol} received`} sub={dstXtz ? 'auto-forwarded to your Michelson address' : 'on your EVM alias'} value={`+${amt(r.dstReceived, dst.decimals, dst.symbol)}`} tone="emerald" />
            <div className="flex justify-between font-mono text-xs text-slate-500">
              <span className="font-sans text-slate-600">{dst.symbol} balance</span>
              <span>{fmtUnits(r.dstBefore, dst.decimals, dst.decimals)} → {fmtUnits(r.dstAfter, dst.decimals, dst.decimals)}</span>
            </div>
            {dstXtz && <div className="border-t border-edge pt-1.5">{feeLine}</div>}
          </div>
        </div>

        {/* network fee — when neither side is XTZ (ERC20 ↔ ERC20), the fee is still paid in XTZ */}
        {!srcXtz && !dstXtz && (
          <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">{feeLine}</div>
        )}

        {/* checks */}
        <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">
          <div className="label mb-2">Checks</div>
          <ul className="space-y-1 text-xs">
            <Check ok={r.paidAsQuoted}>Paid exactly the quoted {src.symbol} ({amt(r.quotedPay, src.decimals, src.symbol)})</Check>
            <Check ok={r.receivedAtLeastMin}>Received at least the guaranteed minimum (≥ {amt(r.minOut, dst.decimals, dst.symbol)})</Check>
          </ul>
        </div>

        <div className="mt-4 flex justify-end">
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
