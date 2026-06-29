'use client';
import { useCallback, useEffect, useState } from 'react';
import { useActiveWallet } from '@/lib/account';
import { useUi } from '@/lib/ui';
import { buildMintListOps, sendChunked, type SellerItem } from '@/lib/opsMichelson';
import { buildEvmMintListBatch } from '@/lib/opsEvm';
import { fetchNextTokenId } from '@/lib/tzkt';
import { txErrorMessage } from '@/lib/errors';
import { nftName } from '@/lib/names';
import { short } from '@/lib/format';
import { NftArt } from './NftArt';
import { DecimalInput } from './DecimalInput';
import { ConnectButton } from './ConnectButton';
import { MintReceiptModal } from './MintReceiptModal';
import { useHistory } from '@/lib/history';
import type { MintReceipt } from '@/lib/receipt';

interface Row {
  tokenId: number;
  name: string;
  priceXtz: number;
}

const DEFAULT_COUNT = 4;
const DEFAULT_PRICE = 0.01;

// Predicted rows for a mint batch: the FA2 counter assigns ids, so the i-th token gets `base + i`.
const buildRows = (base: number, n: number, priceXtz: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ tokenId: base + i, name: nftName(base + i), priceXtz }));

// Resize the preview to `n` rows, keeping prices already set on surviving ids; new rows take the default.
const resizeRows = (base: number, n: number, priceXtz: number, prev: Row[]): Row[] =>
  Array.from({ length: n }, (_, i) => {
    const tokenId = base + i;
    return prev.find((r) => r.tokenId === tokenId) ?? { tokenId, name: nftName(tokenId), priceXtz };
  });

export function SellerPanel() {
  const aw = useActiveWallet();
  const connected = aw.connected;
  const refresh = useUi((s) => s.refresh);
  const addMint = useHistory((s) => s.addMint);
  const [signing, setSigning] = useState<{ i: number; total: number } | null>(null); // MetaMask sequential progress
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [defaultPrice, setDefaultPrice] = useState(DEFAULT_PRICE); // applied to new/rebuilt rows
  const [baseId, setBaseId] = useState<number | null>(null); // FA2 counter, fetched once (not per keystroke)
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [receipt, setReceipt] = useState<MintReceipt | null>(null);

  // Read the FA2 counter and (re)build the preview rows. Called on mount, on Regenerate, and after a mint
  // (the counter advances) — NOT on count changes, which rebuild locally from the cached base.
  const reload = useCallback(async (n: number, priceXtz: number) => {
    try {
      const base = await fetchNextTokenId();
      setBaseId(base);
      setRows(buildRows(base, n, priceXtz));
    } catch (e) {
      setBaseId(null);
      setRows([]);
      setStatus({ ok: false, msg: `Could not read the FA2 token counter: ${(e as Error).message}` });
    }
  }, []);

  useEffect(() => {
    void reload(DEFAULT_COUNT, DEFAULT_PRICE);
  }, [reload]);

  const setPrice = (tokenId: number, priceXtz: number) =>
    setRows((rs) => rs.map((r) => (r.tokenId === tokenId ? { ...r, priceXtz } : r)));

  const setAllPrices = (priceXtz: number) => setRows((rs) => rs.map((r) => ({ ...r, priceXtz })));

  async function mintAndList() {
    if (!aw.connected) return;
    setBusy(true);
    setStatus(null);
    try {
      // re-read the counter right before sending so the predicted ids are as fresh as possible
      const base = await fetchNextTokenId();
      // actual minted ids use this fresh `base` (i-th token => base + i); prices come from the rows
      const minted = rows.map((r, i) => ({ tokenId: base + i, name: nftName(base + i), priceMutez: Math.round(r.priceXtz * 1e6) }));
      const items: SellerItem[] = minted.map((it) => ({ priceMutez: it.priceMutez }));

      let mintReceipt: MintReceipt;
      if (aw.kind === 'metamask') {
        // EVM: each Michelson op (mint / approve / list) is a callMichelson tx; the NFTs mint to the KT1 alias.
        const seller = aw.michelsonOwner;
        if (!seller) return;
        const { txs, stepLabels } = buildEvmMintListBatch(seller, items, base);
        const { hashes } = await aw.evm.sendCalls(txs, (i, total) => setSigning({ i, total }));
        setSigning(null);
        // labels align 1:1 with hashes on the sequential path; an atomic batch collapses to a single tx hash
        const txLabels = hashes.length === stepLabels.length ? stepLabels : hashes.length === 1 ? ['atomic batch'] : undefined;
        mintReceipt = { hashes, items: minted, evm: true, txLabels };
      } else {
        // Temple: one atomic op-group (auto-chunked under the gas ceiling).
        const { tezos, michelsonAddress } = aw.temple;
        if (!tezos || !michelsonAddress) return;
        const ops = buildMintListOps(michelsonAddress, items, base);
        const hashes = await sendChunked(tezos, ops);
        mintReceipt = { hashes, items: minted };
      }

      // The counter advanced by exactly the number of mints. Predict the next base locally instead of
      // re-reading via tzkt, whose indexer lags the just-confirmed block and would still report the old id.
      const nextBase = base + items.length;
      setBaseId(nextBase);
      setRows(buildRows(nextBase, count, defaultPrice));
      setStatus({ ok: true, msg: `Minted & listed ${items.length} NFTs` });
      setReceipt(mintReceipt);
      addMint(mintReceipt); // record in the Activity log so it can be reopened
      refresh();
    } catch (e) {
      setStatus({ ok: false, msg: txErrorMessage(e) });
    } finally {
      setBusy(false);
      setSigning(null);
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
                // rebuild locally (no network), keeping set prices and applying the default to new rows
                if (baseId !== null) setRows((prev) => resizeRows(baseId, n, defaultPrice, prev));
              }}
            />
          </div>
          <div>
            <div className="label mb-1">Default price (XTZ)</div>
            <DecimalInput
              className="input w-32"
              value={defaultPrice}
              onChange={(p) => {
                setDefaultPrice(p); // remembered so a later count change reuses it
                setAllPrices(p);
              }}
            />
          </div>
          <button className="btn-ghost" onClick={() => void reload(count, defaultPrice)} disabled={busy}>
            ↻ Regenerate
          </button>
          {connected ? (
            <button className="btn-primary ml-auto" onClick={() => void mintAndList()} disabled={busy || rows.length === 0}>
              {busy ? (signing ? `Sign ${signing.i + 1}/${signing.total}…` : 'Working…') : `Mint + list ${rows.length} NFTs`}
            </button>
          ) : (
            <ConnectButton header="Connect to mint" wrapperClassName="relative ml-auto" buttonClassName="btn-primary">
              Mint + list {rows.length} NFTs
            </ConnectButton>
          )}
        </div>
        {connected &&
          (aw.kind === 'metamask' ? (
            aw.evm.atomicBatch ? (
              <p className="mt-3 text-xs text-amber-400/80">
                Signed as <span className="font-medium">one atomic batch</span> — {rows.length * 3} ops (mint + approve + list per NFT). NFTs mint to your michelson alias.
              </p>
            ) : (
              <p className="mt-3 text-xs text-amber-400/80">
                You’ll sign <span className="font-medium">{rows.length * 3}</span> txs — mint + approve + list per NFT. NFTs mint to your michelson alias.
              </p>
            )
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Temple signs <span className="font-medium">one atomic op-group</span> (auto-chunked under the gas ceiling). NFTs mint to your michelson account.
            </p>
          ))}
        {connected &&
          (() => {
            const ops =
              aw.kind === 'metamask'
                ? [
                    'callMichelson(fa2.mint()) —NFT→ michelson alias',
                    'callMichelson(fa2.update_operators(objkt))',
                    'callMichelson(objkt.ask())',
                  ]
                : [
                    'fa2.mint() —NFT→ michelson account',
                    'fa2.update_operators(objkt)',
                    'objkt.ask()',
                  ];
            // MetaMask signs the 3N txs one by one — map the live index to the active op (i % 3) and NFT (i / 3).
            const activeOp = signing ? signing.i % 3 : -1;
            const activeNft = signing ? Math.floor(signing.i / 3) + 1 : 0;
            const nftTotal = signing ? Math.ceil(signing.total / 3) : rows.length;
            return (
              <div className="mt-3 rounded-lg border border-edge p-2.5 text-xs">
                <div className="label mb-1">Per NFT · {rows.length} × 3 ops</div>
                <div className="mb-2 text-[11px] text-slate-500">
                  Signed by{' '}
                  {aw.kind === 'metamask'
                    ? `evm account · ${short(aw.evm.evmAddress ?? '')}`
                    : `michelson account · ${short(aw.temple.michelsonAddress ?? '')}`}
                </div>
                <ol className="space-y-1 font-mono text-slate-300">
                  {ops.map((line, idx) => (
                    <li key={idx} className={`flex gap-2 ${activeOp === idx ? 'text-accent' : ''}`}>
                      <span className="w-3 shrink-0 text-right tabular-nums text-slate-600">{activeOp === idx ? '➤' : `${idx + 1}.`}</span>
                      <span className={activeOp === idx ? 'text-accent' : ''}>
                        {line}
                        {activeOp === idx && (
                          <span className="ml-1.5 font-sans text-[10px] uppercase tracking-wide text-accent">signing · NFT {activeNft}/{nftTotal}…</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })()}
        {status && <p className={`mt-3 text-xs ${status.ok ? 'text-accent2' : 'text-rose-400'}`}>{status.msg}</p>}
        <p className="mt-3 text-xs text-slate-500">
          Mints fresh tokens into the test FA2 and lists each as an XTZ-priced ask on objkt. Names are generated; prices
          are editable per item.
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
            <DecimalInput className="input" value={r.priceXtz} onChange={(p) => setPrice(r.tokenId, p)} />
          </div>
        ))}
      </div>

      {receipt && <MintReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
