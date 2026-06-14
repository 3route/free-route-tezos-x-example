'use client';
import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { useUi } from '@/lib/ui';
import { buildMintListOps, freshTokenIds, sendChunked, type SellerItem } from '@/lib/ops';
import { nftName } from '@/lib/names';
import { short } from '@/lib/format';
import { NftArt } from './NftArt';

interface Row {
  tokenId: number;
  name: string;
  priceXtz: number;
}

const DEFAULT_COUNT = 5;
const DEFAULT_PRICE = 0.004;

export function SellerPanel() {
  const { connected, michelsonAddress, tezos } = useWallet();
  const refresh = useUi((s) => s.refresh);
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const regenerate = useCallback((n: number) => {
    const ids = freshTokenIds(n);
    setRows(ids.map((tokenId) => ({ tokenId, name: nftName(tokenId), priceXtz: DEFAULT_PRICE })));
  }, []);

  useEffect(() => {
    regenerate(DEFAULT_COUNT);
  }, [regenerate]);

  const setPrice = (tokenId: number, priceXtz: number) =>
    setRows((rs) => rs.map((r) => (r.tokenId === tokenId ? { ...r, priceXtz } : r)));

  const setAllPrices = (priceXtz: number) => setRows((rs) => rs.map((r) => ({ ...r, priceXtz })));

  async function mintAndList() {
    if (!tezos || !michelsonAddress) return;
    setBusy(true);
    setStatus(null);
    try {
      const items: SellerItem[] = rows.map((r) => ({ tokenId: r.tokenId, priceMutez: Math.round(r.priceXtz * 1e6) }));
      const ops = buildMintListOps(michelsonAddress, items);
      await sendChunked(tezos, ops);
      setStatus({ ok: true, msg: `Minted & listed ${rows.length} NFTs` });
      regenerate(count);
      refresh();
    } catch (e) {
      setStatus({ ok: false, msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="label mb-1">NFTs</div>
            <input
              type="number"
              min={1}
              max={20}
              className="input w-24"
              value={count}
              onChange={(e) => {
                const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                setCount(n);
                regenerate(n);
              }}
            />
          </div>
          <div>
            <div className="label mb-1">Default price (XTZ)</div>
            <input
              type="number"
              step="0.001"
              min={0}
              className="input w-32"
              defaultValue={DEFAULT_PRICE}
              onChange={(e) => setAllPrices(Number(e.target.value) || 0)}
            />
          </div>
          <button className="btn-ghost" onClick={() => regenerate(count)} disabled={busy}>
            ↻ Regenerate
          </button>
          <button className="btn-primary ml-auto" onClick={() => void mintAndList()} disabled={!connected || busy || rows.length === 0}>
            {busy ? 'Working…' : `Mint + list ${rows.length} NFTs`}
          </button>
        </div>
        {!connected && <p className="mt-3 text-xs text-amber-400/80">Connect Temple to mint &amp; list.</p>}
        {status && <p className={`mt-3 text-xs ${status.ok ? 'text-accent2' : 'text-rose-400'}`}>{status.msg}</p>}
        <p className="mt-3 text-xs text-slate-500">
          Mints fresh tokens into the test FA2 and lists each as an XTZ-priced ask on objkt — one click (auto-split into
          batches under the gas ceiling). Names are generated; prices are editable per item.
        </p>
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          ⚠️ objkt blocks buying your own listing (<span className="font-mono">M_NO_SELF_FULFILL</span>). To test a purchase,
          switch to Buyer mode <span className="font-medium">with a different account</span> than the one that listed these.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((r) => (
          <div key={r.tokenId} className="card p-3">
            <NftArt tokenId={r.tokenId} className="mb-3 h-24 w-full rounded-xl" />
            <div className="truncate text-sm font-medium">{r.name}</div>
            <div className="mb-2 font-mono text-[11px] text-slate-500">#{short(String(r.tokenId), 5)}</div>
            <div className="label mb-1">Price (XTZ)</div>
            <input
              type="number"
              step="0.001"
              min={0}
              className="input"
              value={r.priceXtz}
              onChange={(e) => setPrice(r.tokenId, Number(e.target.value) || 0)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
