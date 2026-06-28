'use client';
import { mutezToXtz } from '@/lib/format';
import { CFG } from '@/lib/config';
import type { MintReceipt } from '@/lib/receipt';

const xtz = (mutez: number) => `${mutezToXtz(mutez, 6)} XTZ`;

export function MintReceiptModal({ receipt: r, onClose }: { receipt: MintReceipt; onClose: () => void }) {
  const totalMutez = r.items.reduce((s, it) => s + it.priceMutez, 0);
  const ids = r.items.map((it) => it.tokenId);
  const idRange = ids.length > 1 ? `#${ids[0]}–#${ids[ids.length - 1]}` : `#${ids[0]}`;

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500/15 text-lg text-emerald-400">✓</div>
          <div className="min-w-0">
            <div className="font-semibold">Minted &amp; listed</div>
            <div className="truncate text-xs text-slate-500">
              {r.items.length} NFT{r.items.length > 1 ? 's' : ''} · tokens {idRange}
            </div>
          </div>
        </div>

        {/* summary */}
        <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">
          <div className="label mb-2">Summary</div>
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <span className="text-slate-400">Minted &amp; listed on objkt</span>
              <span className="shrink-0 font-mono">{r.items.length}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-slate-400">Token ids</span>
              <span className="shrink-0 font-mono">{idRange}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-slate-400">Minted to</span>
              <span className="shrink-0 font-mono text-xs text-slate-400">{r.evm ? 'michelson alias' : 'michelson account'}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-t border-edge pt-1.5">
              <span className="text-slate-400">Total ask value</span>
              <span className="shrink-0 font-mono">{xtz(totalMutez)}</span>
            </div>
          </div>
        </div>

        {/* per-item */}
        <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">
          <div className="label mb-2">Items</div>
          <div className="space-y-1">
            {r.items.map((it) => (
              <div key={it.tokenId} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-slate-400">
                  <span className="font-medium text-slate-300">{it.name}</span>{' '}
                  <span className="text-slate-600">#{it.tokenId}</span>
                </span>
                <span className="shrink-0 font-mono text-slate-400">{xtz(it.priceMutez)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* transactions */}
        <div className="mb-3 rounded-xl border border-edge bg-ink/40 p-3 text-sm">
          <div className="label mb-2">Transaction{r.hashes.length > 1 ? 's' : ''}</div>
          <div className="space-y-1">
            {r.hashes.map((h, i) => (
              <a
                key={h}
                className="flex items-center justify-between gap-3 font-mono text-xs text-accent hover:underline"
                href={r.evm ? `${CFG.evmExplorer}/tx/${h}` : `${CFG.explorer}/${h}`}
                target="_blank"
                rel="noreferrer"
                title={h}
              >
                <span className="truncate">{h}</span>
                <span className="shrink-0 text-slate-500">{r.txLabels?.[i] ? `${r.txLabels[i]} ↗` : r.evm ? 'tx ↗' : r.hashes.length > 1 ? `batch ${i + 1} ↗` : 'view on tzkt ↗'}</span>
              </a>
            ))}
          </div>
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
