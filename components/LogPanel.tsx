'use client';
import { useState } from 'react';
import { useHistory, type HistoryEntry } from '@/lib/history';
import { fmtTime, fmtUnits, mutezToXtz } from '@/lib/format';
import { nftName } from '@/lib/names';
import { ReceiptModal } from './ReceiptModal';
import { SwapReceiptModal } from './SwapReceiptModal';
import { MintReceiptModal } from './MintReceiptModal';

// dot color per kind: buy=accent, swap=accent2, mint=amber
const dotColor = (kind: HistoryEntry['kind']) => (kind === 'buy' ? 'bg-accent' : kind === 'swap' ? 'bg-accent2' : 'bg-amber-400');

export function LogPanel() {
  const { entries, clear } = useHistory();
  const [sel, setSel] = useState<HistoryEntry | null>(null);

  return (
    <>
      <div className="card flex h-full flex-col">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300">Activity log</h3>
          {entries.length > 0 && (
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={clear}>
              clear
            </button>
          )}
        </div>

        <div className="flex-1 space-y-1.5 overflow-auto pr-1">
          {entries.length === 0 && <p className="font-mono text-xs text-slate-600">No activity yet.</p>}
          {entries.map((e) => (
            <button
              key={e.id}
              onClick={() => setSel(e)}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-white/5"
              title="view receipt"
            >
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotColor(e.kind)}`} />
              <span className="min-w-0 flex-1">
                {e.kind === 'buy' ? (
                  <span className="text-slate-300">
                    Bought <span className="font-medium">{nftName(e.tokenId)}</span>{' '}
                    <span className="text-slate-500">· −{fmtUnits(e.receipt.usdcSpent, e.token.decimals, e.token.decimals)} {e.token.symbol}</span>
                  </span>
                ) : e.kind === 'swap' ? (
                  <span className="text-slate-300">
                    Swapped <span className="font-medium">{e.receipt.src.symbol} → {e.receipt.dst.symbol}</span>{' '}
                    <span className="text-slate-500">· +{fmtUnits(e.receipt.dstReceived, e.receipt.dst.decimals, e.receipt.dst.decimals)} {e.receipt.dst.symbol}</span>
                  </span>
                ) : (
                  <span className="text-slate-300">
                    Listed <span className="font-medium">{e.receipt.items.length} NFT{e.receipt.items.length > 1 ? 's' : ''}</span>{' '}
                    <span className="text-slate-500">· {mutezToXtz(e.receipt.items.reduce((s, it) => s + it.priceMutez, 0), 6)} XTZ</span>
                  </span>
                )}
                <span className="block font-mono text-[11px] text-slate-600">{fmtTime(e.ts)} · view receipt ↗</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* modals live OUTSIDE the .card — its backdrop-blur-sm creates a containing block that would trap fixed overlays */}
      {sel?.kind === 'buy' && <ReceiptModal receipt={sel.receipt} token={sel.token} tokenId={sel.tokenId} onClose={() => setSel(null)} />}
      {sel?.kind === 'swap' && <SwapReceiptModal receipt={sel.receipt} onClose={() => setSel(null)} />}
      {sel?.kind === 'mint' && <MintReceiptModal receipt={sel.receipt} onClose={() => setSel(null)} />}
    </>
  );
}
