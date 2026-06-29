'use client';
// Fallback success modal — shown when the action confirmed on-chain but the measured receipt couldn't be built
// (tzkt indexer lag), or for the EVM path which has no Michelson receipt. Always gives the user explorer links.
import { CFG } from '@/lib/config';

export function SubmittedModal({ title, note, hashes, evm, onClose }: { title: string; note: string; hashes: string[]; evm: boolean; onClose: () => void }) {
  const link = (h: string) => (evm ? `${CFG.evmExplorer}/tx/${h}` : `${CFG.explorer}/${h}`);
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500/15 text-lg text-emerald-400">✓</div>
          <div className="min-w-0">
            <div className="font-semibold">{title}</div>
            <div className="text-xs text-slate-500">{note}</div>
          </div>
        </div>
        <div className="space-y-1.5 rounded-lg border border-edge p-2.5">
          {hashes.map((h, i) => (
            <a key={h} href={link(h)} target="_blank" rel="noreferrer" className="block truncate font-mono text-[11px] text-accent hover:underline">
              {hashes.length > 1 ? `${i + 1}. ` : ''}view {evm ? 'tx' : 'op'} ↗ {h}
            </a>
          ))}
        </div>
        <button className="btn-primary mt-4 w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
