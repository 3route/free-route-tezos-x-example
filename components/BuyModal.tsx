'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ParamsWithKind } from '@taquito/taquito';
import { useWallet } from '@/lib/wallet';
import { useActiveWallet } from '@/lib/account';
import { useUi } from '@/lib/ui';
import { useBalances, useTokens } from '@/lib/hooks';
import { buildBuyBatch, sendWalletGroup, type BuyDetails } from '@/lib/opsMichelson';
import { buildEvmBuyBatch } from '@/lib/opsEvm';
import type { EvmTxRequest } from '@baking-bad/free-route-tezos-x';
import { fmtUnits, mutezToXtz, short } from '@/lib/format';
import { nftName } from '@/lib/names';
import { useHistory } from '@/lib/history';
import { txErrorMessage } from '@/lib/errors';
import { fetchErc20Balance, fetchEvmXtzBalanceWei, fetchXtzBalance, type Listing } from '@/lib/tzkt';
import { buildBuyReceipt, buildEvmBuyReceipt, type BuyReceipt } from '@/lib/receipt';
import { ReceiptModal } from './ReceiptModal';
import { SubmittedModal } from './SubmittedModal';
import { NftArt } from './NftArt';

const Spinner = () => <div className="h-6 w-6 animate-spin rounded-full border-2 border-edge border-t-accent" />;

const SLIPPAGES = [
  { label: '0.1%', bps: 10 },
  { label: '0.5%', bps: 50 },
  { label: '1%', bps: 100 },
];
const MIN_SLIPPAGE_BPS = 0; // 0% — zero tolerance is allowed (warned as very low)
const MAX_SLIPPAGE_BPS = 4900; // 49%

// Validate the recipient Michelson address (tz1/2/3 or KT1) for the "send to another address" option — the NFT
// is a Michelson-side asset (objkt proxy_for). Empty → a required error. Returns the address + a validation error.
function resolveRecipient(input: string): { recipient: string | null; error: string | null } {
  const v = input.trim();
  if (!v) return { recipient: null, error: 'Enter a recipient address' };
  if (/^(tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) return { recipient: v, error: null };
  return { recipient: null, error: 'Enter a valid tz1 / KT1 Michelson address' };
}

export function BuyModal({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const { tezos, michelsonAddress, aliasAddress } = useWallet(); // Temple path (Michelson signing + receipt)
  const aw = useActiveWallet();
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
  const [done, setDone] = useState<{ hashes: string[]; evm: boolean } | null>(null); // fallback when no measured receipt
  // the executable, discriminated by the active signing direction: Michelson op-group vs EVM tx batch
  const [built, setBuilt] = useState<{ kind: 'temple'; ops: ParamsWithKind[] } | { kind: 'metamask'; txs: EvmTxRequest[] } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [finalizing, setFinalizing] = useState(false); // tx sent, building the on-chain receipt
  const [signingIndex, setSigningIndex] = useState<number | null>(null); // MetaMask sequential: which call is being signed
  const [err, setErr] = useState<string | null>(null);
  const [quotedAt, setQuotedAt] = useState<number | null>(null); // last successful quote (for the 30s countdown)
  const [recipientMode, setRecipientMode] = useState<'me' | 'other'>('me'); // who gets the NFT
  const [recipientInput, setRecipientInput] = useState(''); // address used only in 'other' mode (objkt proxy_for)

  const priceMutez = Number(listing.priceMutez);
  // 'me' → null (default self, no error). 'other' → the validated address, with a required/invalid error.
  const { recipient: resolvedRecipient, error: recipientError } = useMemo(
    () => (recipientMode === 'me' ? { recipient: null, error: null } : resolveRecipient(recipientInput)),
    [recipientMode, recipientInput],
  );
  // a custom recipient equal to our own default NFT owner is just "to me" — drop it so the notation/receipt read as self
  const effectiveRecipient = resolvedRecipient && resolvedRecipient !== aw.michelsonOwner ? resolvedRecipient : null;

  // EVM address that runs the swap & pays: the connected 0x (MetaMask) or the Michelson account's alias (Temple).
  const payer = aw.kind === 'metamask' ? aw.evm.evmAddress : michelsonAddress;

  // (re)quote on token/slippage change, and auto-refresh every 30s (re-hits the free-route SDK)
  useEffect(() => {
    if (!payer || !token) return;
    let cancelled = false;
    const requote = () => {
      setQuoting(true);
      setErr(null);
      setBuilt(null); // never allow sending a stale batch mid-requote (Buy is also disabled while quoting)
      // keep the previous `details` on screen (stale-while-revalidate) so the panel doesn't collapse/jump
      const ask = { askId: listing.askId, tokenId: listing.tokenId, priceMutez };
      const job =
        aw.kind === 'metamask'
          ? buildEvmBuyBatch(payer, ask, token, slippageBps, effectiveRecipient).then(({ txs, details: d }) => ({ b: { kind: 'metamask' as const, txs }, d }))
          : buildBuyBatch(payer, ask, token, slippageBps, effectiveRecipient).then(({ ops, details: d }) => ({ b: { kind: 'temple' as const, ops }, d }));
      job
        .then(({ b, d }) => {
          if (!cancelled) {
            setBuilt(b);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payer, aw.kind, token, slippageBps, listing, priceMutez, effectiveRecipient]);

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
  // where the leftover XTZ (change) lands: the Michelson account (Temple) or the EVM account (MetaMask)
  // where the pay-token is debited from / where the swapped XTZ + leftover change land — holder on the active side.
  const payFrom = aw.kind === 'metamask' ? 'from evm account' : 'from evm alias';
  const xtzTo = aw.kind === 'metamask' ? 'to evm account' : 'to michelson account (auto-forward)';

  async function confirm() {
    if (!built || !token || !details) return;
    setBuying(true);
    setErr(null);
    try {
      // MetaMask (EVM): send the approve+swap+fulfill batch; the NFT lands on the account's KT1 alias (see Owned).
      if (built.kind === 'metamask') {
        const acct = aw.evm.evmAddress;
        const nftAlias = aw.evm.aliasAddress; // KT1 where the NFT lands
        if (!acct || !nftAlias) return;
        // snapshot EVM-side balances BEFORE so the receipt is measured (mirror of the Michelson path)
        const [xtz0, usdc0] = await Promise.all([fetchEvmXtzBalanceWei(acct), fetchErc20Balance(token.address, acct)]);
        const { hashes } = await aw.evm.sendCalls(built.txs, (i) => setSigningIndex(i));
        setSigningIndex(null);
        setFinalizing(true);
        refresh();
        try {
          const r = await buildEvmBuyReceipt({
            hashes,
            stepLabels: details.steps.map((s) => s.kind),
            account: acct,
            nftAlias,
            payTokenAddress: token.address,
            tokenId: listing.tokenId,
            quotedSrcAmount: BigInt(details.payAmount),
            expectedChange: BigInt(details.changeMutez),
            fulfillMutez: BigInt(priceMutez),
            recipient: effectiveRecipient,
            before: { xtz: xtz0, usdc: usdc0 },
          });
          addBuy(r, token, listing.tokenId, listing.askId);
          setReceipt(r);
        } catch {
          setDone({ hashes, evm: true }); // measured receipt unavailable — fall back to the link
        }
        return;
      }
      // Temple (Michelson): sign the op-group, then build the measured on-chain receipt.
      if (!tezos || !michelsonAddress || !aliasAddress) return;
      // snapshot real balances BEFORE (live node reads) so the receipt is measured, not estimated
      const [xtz0, usdc0] = await Promise.all([fetchXtzBalance(michelsonAddress), fetchErc20Balance(token.address, aliasAddress)]);
      const hash = await sendWalletGroup(tezos, built.ops);
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
          recipient: effectiveRecipient,
          before: { xtz: xtz0, usdc: usdc0 },
        });
        addBuy(r, token, listing.tokenId, listing.askId); // record in the activity log
        setReceipt(r); // show the receipt modal
      } catch {
        setDone({ hashes: [hash], evm: false }); // receipt unavailable (indexer lag) — the buy itself still succeeded
      }
    } catch (e) {
      setErr(txErrorMessage(e));
    } finally {
      setBuying(false);
      setFinalizing(false);
      setSigningIndex(null);
    }
  }

  // once bought, swap the review for the measured on-chain receipt
  if (receipt && token) return <ReceiptModal receipt={receipt} token={token} tokenId={listing.tokenId} askId={listing.askId} onClose={onClose} />;
  if (done)
    return (
      <SubmittedModal
        title="Purchase submitted"
        note={
          effectiveRecipient
            ? `Confirmed on-chain. The NFT was sent to ${short(effectiveRecipient, 6)}.`
            : done.evm
              ? 'Confirmed on-chain. The NFT landed on your michelson alias — see Owned.'
              : 'Confirmed on-chain. The measured receipt wasn’t ready yet (indexer lag) — see Owned.'
        }
        hashes={done.hashes}
        evm={done.evm}
        onClose={onClose}
      />
    );

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="mb-3 flex items-center gap-3">
          <NftArt tokenId={listing.tokenId} className="h-12 w-12 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <div className="font-semibold">{nftName(listing.tokenId)}</div>
            <div className="font-mono text-[11px] text-slate-500">ask {listing.askId}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xl font-semibold">{mutezToXtz(priceMutez, 6)}</div>
            <div className="text-xs text-slate-500">XTZ price</div>
          </div>
        </div>

        {/* pay token — compact chips, like the listing switcher */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <div className="mb-3">
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
                className="w-14 bg-transparent text-right outline-hidden [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              %
            </span>
          </div>
          {slippageBps > 500 && <p className="mt-1.5 text-[11px] text-amber-400">High slippage — you may overpay.</p>}
          {slippageBps < 10 && <p className="mt-1.5 text-[11px] text-amber-400">Very low — the swap may revert on a thin pool.</p>}
          <p className="mt-1.5 text-[11px] text-slate-500">
            quote via free-route{refreshInSec !== null ? ` · updating in ${refreshInSec}s` : ''}
          </p>
        </div>

        {/* review */}
        <div className="text-sm">
          <div className="relative min-h-60">
            {err && !details && (
              <div className="grid h-60 place-items-center text-center text-xs text-rose-400">{err}</div>
            )}
            {details && token && (
            <div className={`space-y-2.5 transition-opacity ${quoting ? 'opacity-40' : 'opacity-100'}`}>
              {/* swap summary — the ERC20 you spend (evm account / evm alias) and the native-XTZ leg that funds the
                  ask; the NFT lands on the michelson alias. Both legs in one box to keep the modal compact. */}
              <div className="rounded-lg border border-edge p-2.5">
                <div className="divide-y divide-edge">
                  <div className="flex items-start justify-between pb-2">
                    <span className="text-slate-400">
                      You pay <span className="text-[10px] uppercase tracking-wide text-slate-600">exact</span>
                    </span>
                    <span className="text-right font-mono">
                      <span className="block">{fmtUnits(details.payAmount, token.decimals, token.decimals)} {token.symbol}</span>
                      <span className="block text-[11px] text-slate-600">{payFrom}</span>
                    </span>
                  </div>
                  <div className="flex items-start justify-between py-2">
                    <span className="text-slate-400">You receive</span>
                    <span className="text-right font-mono">
                      <span className="block">≈ {mutezToXtz(details.expectedOutMutez, 6)} XTZ</span>
                      <span className="block text-xs text-slate-500">≥ {mutezToXtz(details.minOutMutez, 6)} XTZ guaranteed</span>
                      <span className="block text-[11px] text-slate-600">{xtzTo}</span>
                    </span>
                  </div>
                  {/* the received XTZ pays the ask price; the surplus is kept as change */}
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-slate-400">NFT price</span>
                    <span className="font-mono">
                      {mutezToXtz(priceMutez, 6)} XTZ
                      <span className="text-slate-500"> · keep ≈ {mutezToXtz(details.changeMutez, 6)} change</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* recipient — who gets the NFT: yourself (default) or another Michelson address (objkt proxy_for) */}
              <div className="rounded-lg border border-edge p-2.5">
                <div className="flex items-center gap-2">
                  <span className="label">Recipient</span>
                  <button
                    type="button"
                    onClick={() => setRecipientMode('me')}
                    className={`chip ${recipientMode === 'me' ? 'border-accent text-accent' : ''}`}
                  >
                    To me
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecipientMode('other')}
                    className={`chip ${recipientMode === 'other' ? 'border-accent text-accent' : ''}`}
                  >
                    Another address
                  </button>
                </div>
                {recipientMode === 'me' ? (
                  <p className="mt-1.5 text-[11px] text-slate-600">
                    NFT goes to your {aw.kind === 'metamask' ? 'michelson alias' : 'michelson account'}
                    {aw.michelsonOwner && <span className="ml-1 font-mono text-slate-500">{short(aw.michelsonOwner, 8)}</span>}.
                  </p>
                ) : (
                  <>
                    <input
                      className={`input mt-2 font-mono text-xs ${recipientError ? 'border-rose-400/60' : ''}`}
                      placeholder="tz1… / KT1… Michelson address"
                      value={recipientInput}
                      onChange={(e) => setRecipientInput(e.target.value)}
                      spellCheck={false}
                      autoFocus
                    />
                    <p className="mt-1.5 text-[11px] text-slate-600">
                      {recipientError ? (
                        <span className="text-rose-400">{recipientError}</span>
                      ) : !effectiveRecipient ? (
                        // a valid address that equals our own default owner → collapses to "To me"
                        <span>That’s your {aw.kind === 'metamask' ? 'michelson alias' : 'michelson account'} — same as “To me”.</span>
                      ) : (
                        <span>
                          NFT → <span className="font-mono text-slate-400">{short(effectiveRecipient, 8)}</span>
                        </span>
                      )}
                    </p>
                  </>
                )}
              </div>

              {/* steps — FROM → operation → TO notation */}
              <div className="rounded-lg border border-edge p-2.5">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="label">
                    {aw.kind !== 'metamask'
                      ? 'One signature · atomic op-group'
                      : aw.evm.atomicBatch
                        ? '1 signature · atomic batch'
                        : `${details.steps.length} signature${details.steps.length > 1 ? 's' : ''} · sign one by one`}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {aw.kind === 'metamask'
                      ? `evm account · ${short(aw.evm.evmAddress ?? '')}`
                      : `michelson account · ${short(michelsonAddress ?? '')}`}
                  </span>
                </div>
                <ol className="space-y-1 text-xs text-slate-400">
                  {details.steps.map((s, i) => (
                    <li key={i} className={`flex gap-2 ${signingIndex === i ? 'text-accent' : ''}`}>
                      <span className="w-3 shrink-0 text-right tabular-nums text-slate-600">{signingIndex === i ? '➤' : `${i + 1}.`}</span>
                      <span className={`font-mono ${signingIndex === i ? 'text-accent' : 'text-slate-300'}`}>
                        {s.detail}
                        {signingIndex === i && <span className="ml-1.5 font-sans text-[10px] uppercase tracking-wide text-accent">signing…</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {!enough && (
                <div className="text-xs text-amber-400">
                  {aw.kind === 'metamask' ? 'evm account' : 'evm alias'} balance ({fmtUnits(bal, token.decimals, token.decimals)} {token.symbol}) is below the required amount.{' '}
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
        <div className="mt-3 flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={buying}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void confirm()} disabled={!built || buying || quoting || !enough || !!recipientError}>
            {buying
              ? finalizing
                ? 'Finalizing…'
                : signingIndex !== null && details
                  ? `Sign ${signingIndex + 1}/${details.steps.length}…`
                  : 'Signing…'
              : `Buy with ${token?.symbol ?? ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
