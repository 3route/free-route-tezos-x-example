'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ParamsWithKind } from '@taquito/taquito';
import { useWallet } from '@/lib/wallet';
import { useUi } from '@/lib/ui';
import { useBalances, useTokens } from '@/lib/hooks';
import { buildBuyBatch, sendWalletGroup, type BuyDetails } from '@/lib/ops';
import { fmtUnits, mutezToXtz, short } from '@/lib/format';
import { nftHue, nftName } from '@/lib/names';
import { useHistory } from '@/lib/history';
import { CFG } from '@/lib/config';
import { fetchErc20Balance, fetchXtzBalance, type Listing } from '@/lib/tzkt';
import { buildBuyReceipt, type BuyReceipt } from '@/lib/receipt';
import { ReceiptModal } from './ReceiptModal';

const Spinner = () => <div className="h-6 w-6 animate-spin rounded-full border-2 border-edge border-t-accent" />;

const SLIPPAGES = [
  { label: '0.1%', bps: 10 },
  { label: '0.5%', bps: 50 },
  { label: '1%', bps: 100 },
];
const MIN_SLIPPAGE_BPS = 0; // 0% — zero tolerance is allowed (warned as very low)
const MAX_SLIPPAGE_BPS = 4900; // 49%

export function BuyModal({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const { tezos, michelsonAddress, aliasAddress } = useWallet();
  const refresh = useUi((s) => s.refresh);
  const addBuy = useHistory((s) => s.addBuy);
  const { payTokens } = useTokens();
  const { erc } = useBalances();

  // selected pay-token comes from the GLOBAL currency (shared with the listing switcher); fall back to
  // the first token when the listing is in XTZ-only mode.
  const currency = useUi((s) => s.currency);
  const setCurrency = useUi((s) => s.setCurrency);
  const token = payTokens.find((t) => t.address === currency) ?? payTokens[0] ?? null;
  const slippageBps = useUi((s) => s.slippageBps); // global slippage (shared with the listing cards)
  const setSlippageBps = useUi((s) => s.setSlippageBps);
  // raw % text for the custom field ('' = a preset is active); pre-fill if the global value isn't a preset
  const [customSlippage, setCustomSlippage] = useState(() =>
    SLIPPAGES.some((s) => s.bps === slippageBps) ? '' : String(slippageBps / 100),
  );
  const [details, setDetails] = useState<BuyDetails | null>(null);
  const [receipt, setReceipt] = useState<BuyReceipt | null>(null);
  const [ops, setOps] = useState<ParamsWithKind[] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [finalizing, setFinalizing] = useState(false); // tx sent, building the on-chain receipt
  const [err, setErr] = useState<string | null>(null);
  const [quotedAt, setQuotedAt] = useState<number | null>(null); // last successful quote (for the 30s countdown)

  const priceMutez = Number(listing.priceMutez);

  // (re)quote on token/slippage change, and auto-refresh every 30s (re-hits the 3route SDK)
  useEffect(() => {
    if (!tezos || !michelsonAddress || !token) return;
    let cancelled = false;
    const requote = () => {
      setQuoting(true);
      setErr(null);
      setOps(null); // never allow sending stale ops mid-requote (Buy is also disabled while quoting)
      // keep the previous `details` on screen (stale-while-revalidate) so the panel doesn't collapse/jump
      buildBuyBatch(michelsonAddress, { askId: listing.askId, tokenId: listing.tokenId, priceMutez }, token, slippageBps)
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
  }, [tezos, michelsonAddress, token, slippageBps, listing, priceMutez]);

  // 1s tick for the "updating in Ns" countdown to the next 30s re-quote
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const refreshInSec = quotedAt ? Math.max(0, 30 - Math.round((now - quotedAt) / 1000)) : null;

  const bal = token ? erc[token.address] ?? 0n : 0n;
  const need = details ? BigInt(details.payAmount) : 0n;
  const enough = !details || bal >= need;

  async function confirm() {
    if (!tezos || !ops || !token || !michelsonAddress || !aliasAddress || !details) return;
    setBuying(true);
    setErr(null);
    try {
      // snapshot real balances BEFORE (live node reads) so the receipt is measured, not estimated
      const [xtz0, usdc0] = await Promise.all([fetchXtzBalance(michelsonAddress), fetchErc20Balance(token.address, aliasAddress)]);
      const hash = await sendWalletGroup(tezos, ops);
      setFinalizing(true); // tx confirmed — now reading the on-chain receipt
      refresh(); // update listings/balances in the background
      // build the exact on-chain receipt (best-effort — never block the success on indexer lag)
      try {
        const r = await buildBuyReceipt({
          opHash: hash,
          buyer: michelsonAddress,
          aliasAddress,
          payTokenAddress: token.address,
          tokenId: listing.tokenId,
          quotedSrcAmount: BigInt(details.payAmount),
          expectedChange: BigInt(details.changeMutez),
          before: { xtz: xtz0, usdc: usdc0 },
        });
        addBuy(r, token, listing.tokenId); // record in the activity log
        setReceipt(r); // show the receipt modal
      } catch {
        onClose(); // receipt unavailable (indexer lag) — the buy itself still succeeded
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBuying(false);
      setFinalizing(false);
    }
  }

  // once bought, swap the review for the measured on-chain receipt
  if (receipt && token) return <ReceiptModal receipt={receipt} token={token} tokenId={listing.tokenId} onClose={onClose} />;

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="mb-4 flex items-center gap-3">
          <div
            className="h-14 w-14 rounded-xl"
            style={{ background: `linear-gradient(135deg, hsl(${nftHue(listing.tokenId)} 70% 55%), hsl(${(nftHue(listing.tokenId) + 60) % 360} 70% 45%))` }}
          />
          <div className="min-w-0">
            <div className="font-semibold">{nftName(listing.tokenId)}</div>
            <div className="font-mono text-[11px] text-slate-500">
              ask {listing.askId} · #{short(listing.tokenId, 6)}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xl font-semibold">{mutezToXtz(priceMutez, 6)}</div>
            <div className="text-xs text-slate-500">XTZ price</div>
          </div>
        </div>

        {/* pay token — compact chips, like the listing switcher */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="label">Pay with</span>
          {payTokens.map((t) => (
            <button
              key={t.address}
              onClick={() => setCurrency(t.address)}
              className={`chip ${token?.address === t.address ? 'border-accent text-accent' : ''}`}
            >
              {t.symbol}
            </button>
          ))}
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
                  if (!Number.isFinite(pct) || pct < 0) return; // ignore non-numeric / negative
                  const maxPct = MAX_SLIPPAGE_BPS / 100;
                  // cap the entered value so you can't type beyond the allowed range
                  const text = pct > maxPct ? ((pct = maxPct), String(maxPct)) : raw;
                  setCustomSlippage(text);
                  setSlippageBps(Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.round(pct * 100))));
                }}
                className="w-14 bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              %
            </span>
          </div>
          {slippageBps > 500 && <p className="mt-1.5 text-[11px] text-amber-400">High slippage — you may overpay.</p>}
          {slippageBps < 10 && <p className="mt-1.5 text-[11px] text-amber-400">Very low — the swap may revert on a thin pool.</p>}
          <p className="mt-1.5 text-[11px] text-slate-500">
            quote via 3route{refreshInSec !== null ? ` · updating in ${refreshInSec}s` : ''}
          </p>
        </div>

        {/* review */}
        <div className="text-sm">
          <div className="relative min-h-[15rem]">
            {err && !details && (
              <div className="grid h-[15rem] place-items-center text-center text-xs text-rose-400">{err}</div>
            )}
            {details && token && (
            <div className={`space-y-3 transition-opacity ${quoting ? 'opacity-40' : 'opacity-100'}`}>
              {/* EVM Side */}
              <div className="rounded-lg border border-edge p-2.5">
                <div className="label mb-1.5">EVM Side</div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">
                    You pay <span className="text-[10px] uppercase tracking-wide text-slate-600">exact</span>
                  </span>
                  <span className="font-mono">{fmtUnits(details.payAmount, token.decimals, token.decimals)} {token.symbol}</span>
                </div>
              </div>

              {/* Michelson Side */}
              <div className="rounded-lg border border-edge p-2.5">
                <div className="label mb-1.5">Michelson Side</div>
                <div className="divide-y divide-edge">
                  <div className="flex items-start justify-between pb-2">
                    <span className="text-slate-400">You receive</span>
                    <span className="text-right font-mono">
                      <span className="block">
                        ≈ {mutezToXtz(details.expectedOutMutez, 6)} XTZ{' '}
                        <span className="text-[10px] uppercase tracking-wide text-slate-600">expected</span>
                      </span>
                      <span className="block text-xs text-slate-500">≥ {mutezToXtz(details.minOutMutez, 6)} XTZ guaranteed</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400">NFT price</span>
                    <span className="font-mono">{mutezToXtz(priceMutez, 6)} XTZ</span>
                  </div>
                  <div className="flex items-start justify-between pt-2">
                    <span className="text-slate-400">Change</span>
                    <span className="text-right font-mono">
                      <span className="block">
                        ≈ {mutezToXtz(details.changeMutez, 6)} XTZ{' '}
                        <span className="text-[10px] uppercase tracking-wide text-slate-600">expected</span>
                      </span>
                      <span className="block text-xs text-slate-500">
                        returns to your{' '}
                        <a href={`${CFG.explorer}/${michelsonAddress}`} target="_blank" rel="noreferrer" className="text-accent hover:underline" title={michelsonAddress ?? ''}>
                          {short(michelsonAddress ?? '', 6)}
                        </a>
                      </span>
                    </span>
                  </div>
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
                  Alias balance ({fmtUnits(bal, token.decimals, token.decimals)} {token.symbol}) is below the required amount.{' '}
                  <Link href="/bridge" className="font-medium underline hover:text-amber-300">
                    Get {token.symbol} on the Bridge ↗
                  </Link>
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
          <button className="btn-ghost" onClick={onClose} disabled={buying}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void confirm()} disabled={!ops || buying || quoting || !enough}>
            {buying ? (finalizing ? 'Finalizing…' : 'Signing…') : `Buy with ${token?.symbol ?? ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
