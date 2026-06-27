'use client';
import { fmtUnits, mutezToXtz } from '@/lib/format';
import { nftName } from '@/lib/names';
import { CFG } from '@/lib/config';
import type { FreeRouteToken } from '@baking-bad/free-route-tezos-x';
import type { BuyReceipt } from '@/lib/receipt';

// signed XTZ display (µtz bigint -> "±N.NNN XTZ")
const sx = (v: bigint) => `${v < 0n ? '−' : v > 0n ? '+' : ''}${mutezToXtz(v < 0n ? -v : v, 6)} XTZ`;
const xtz = (v: bigint) => `${mutezToXtz(v, 6)} XTZ`;

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

export function ReceiptModal({ receipt: r, token, tokenId, onClose }: { receipt: BuyReceipt; token: FreeRouteToken; tokenId: string; onClose: () => void }) {
  const sym = token.symbol;
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500/15 text-lg text-emerald-400">✓</div>
          <div className="min-w-0">
            <div className="font-semibold">Purchase complete</div>
            <div className="truncate text-xs text-slate-500">
              {nftName(tokenId)} ·{' '}
              <a className="text-accent hover:underline" href={`${CFG.explorer}/${r.opHash}`} target="_blank" rel="noreferrer">
                view on tzkt ↗
              </a>
            </div>
          </div>
        </div>

        {/* EVM side — measured */}
        <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">
          <div className="label mb-2">EVM Side</div>
          <div className="space-y-1.5">
            <Line label={`${sym} paid (alias)`} value={`−${fmtUnits(r.usdcSpent, token.decimals, token.decimals)} ${sym}`} />
            <div className="flex justify-between font-mono text-xs text-slate-500">
              <span className="font-sans text-slate-600">alias {sym} balance</span>
              <span>{fmtUnits(r.usdcBefore, token.decimals, token.decimals)} → {fmtUnits(r.usdcAfter, token.decimals, token.decimals)}</span>
            </div>
          </div>
        </div>

        {/* Michelson side — measured */}
        <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">
          <div className="label mb-2">Michelson Side</div>
          <div className="space-y-1.5">
            <Line label="Change returned" sub={`swap surplus · expected +${xtz(r.expectedChange)} from quote`} value={`+${xtz(r.actualChange)}`} tone="emerald" />
            <Line label="Network fee" sub="actual paid fee · Σ bakerFee" value={sx(-r.networkFee)} tone="muted" />
            <div className="border-t border-edge pt-1.5">
              <Line label="Net XTZ" sub="= change − fee" value={sx(r.xtzNet)} />
            </div>
            <div className="flex justify-between font-mono text-xs text-slate-500">
              <span className="font-sans text-slate-600">Michelson XTZ balance</span>
              <span>{xtz(r.xtzBefore)} → {xtz(r.xtzAfter)}</span>
            </div>
            <div className="border-t border-edge pt-1.5">
              <Line label="Buyer → objkt (fulfill_ask)" sub="XTZ you sent to the marketplace · funded by the swap" value={xtz(r.fulfillAmount)} />
            </div>
          </div>
        </div>

        {/* checks */}
        <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">
          <div className="label mb-2">Checks</div>
          <ul className="space-y-1 text-xs">
            <Check ok={r.paidAsQuoted}>Paid exactly the quoted {sym} ({fmtUnits(r.usdcSpent, token.decimals, token.decimals)})</Check>
            {r.actualChange > 0n && (
              <Check ok={r.changeWithinExpected}>Change returned within the quoted estimate (≤ {xtz(r.expectedChange)})</Check>
            )}
            <Check ok={r.nftOwned}>NFT now owned by your Michelson address</Check>
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
