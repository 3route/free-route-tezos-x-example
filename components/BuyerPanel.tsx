'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useListings, usePriceCurrency, useTokens } from '@/lib/hooks';
import { useActiveWallet } from '@/lib/account';
import { fmtSig, mutezToXtz, short } from '@/lib/format';
import { nftName } from '@/lib/names';
import { BuyModal } from './BuyModal';
import { ConnectButton } from './ConnectButton';
import { NftArt } from './NftArt';
import { Select, type SelectOption } from './Select';
import type { Listing } from '@/lib/tzkt';

type SortKey = 'new' | 'old' | 'price-asc' | 'price-desc' | 'name';
const SORTS: SelectOption<SortKey>[] = [
  { value: 'new', label: 'Newest' },
  { value: 'old', label: 'Oldest' },
  { value: 'price-asc', label: 'Price ↑' },
  { value: 'price-desc', label: 'Price ↓' },
  { value: 'name', label: 'Name A–Z' },
];

// Buy CTA. Connected → opens the buy modal. Disconnected → the shared Temple / MetaMask connect picker,
// so a buyer can start from either signing direction instead of being forced onto one.
function BuyButton({
  connected,
  sub,
  onBuy,
  onOpenChange,
}: {
  connected: boolean;
  sub: ReactNode;
  onBuy: () => void;
  onOpenChange?: (open: boolean) => void; // lets the parent raise this card above siblings while the picker is open
}) {
  if (connected) {
    return (
      <button className="btn-primary mt-2 flex-col gap-0 py-2! leading-tight" onClick={onBuy}>
        <span>Buy</span>
        {sub}
      </button>
    );
  }
  return (
    <ConnectButton
      header="Connect to buy"
      wrapperClassName="relative mt-2"
      buttonClassName="btn-primary w-full flex-col gap-0 py-2! leading-tight"
      onOpenChange={onOpenChange}
    >
      <span>Buy</span>
      {sub}
    </ConnectButton>
  );
}

export function BuyerPanel() {
  const { listings, loading, refresh } = useListings();
  const aw = useActiveWallet();
  const connected = aw.connected;
  const { payTokens } = useTokens();
  const { currency, setCurrency, token, convert, rateLabel, updatedAt, error } = usePriceCurrency(payTokens);
  const [sel, setSel] = useState<Listing | null>(null);
  const [pickerOpen, setPickerOpen] = useState<string | null>(null); // askId whose connect-picker is open (raise its card)
  const [sort, setSort] = useState<SortKey>('new');

  const sorted = useMemo(() => {
    const arr = [...listings];
    const price = (l: Listing) => BigInt(l.priceMutez);
    switch (sort) {
      case 'new':
        return arr.sort((a, b) => Number(b.askId) - Number(a.askId));
      case 'old':
        return arr.sort((a, b) => Number(a.askId) - Number(b.askId));
      case 'price-asc':
        return arr.sort((a, b) => (price(a) < price(b) ? -1 : price(a) > price(b) ? 1 : 0));
      case 'price-desc':
        return arr.sort((a, b) => (price(b) < price(a) ? -1 : price(b) > price(a) ? 1 : 0));
      case 'name':
        return arr.sort((a, b) => nftName(a.tokenId).localeCompare(nftName(b.tokenId)));
      default:
        return arr;
    }
  }, [listings, sort]);

  // tick every second so the "updated Ns ago" label stays fresh
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  const inSec = ago !== null ? Math.max(0, 30 - ago) : null; // countdown to the next rate refresh (30s)

  // Only ERC20s in the switcher — the card already shows the XTZ price. Clicking the active one again
  // toggles back to the XTZ-only view (currency 'XTZ').
  const currencies = payTokens.map((t) => t.address);
  const symbolOf = (c: string) => payTokens.find((t) => t.address === c)?.symbol ?? '?';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Listings <span className="ml-1 text-sm text-slate-500">{listings.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          <span className="label">Sort</span>
          <Select value={sort} options={SORTS} onChange={setSort} />
          <button className="btn-ghost" onClick={() => void refresh()}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* currency switcher */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">Show price in</span>
          {currencies.map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`chip ${currency === c ? 'border-accent text-accent' : ''}`}
            >
              {symbolOf(c)}
            </button>
          ))}
        </div>
        {currency !== 'XTZ' && (
          <div className="text-[11px] text-slate-500">
            {error ? (
              <span className="text-rose-400">rate unavailable</span>
            ) : (
              <>
                {rateLabel ? <span className="text-slate-400">{rateLabel}</span> : 'quoting…'} · via free-route
                {inSec !== null ? ` · updating in ${inSec}s` : ''}
              </>
            )}
          </div>
        )}
      </div>

      {listings.length === 0 && (
        <div className="card flex flex-col items-start gap-3 text-sm text-slate-500">
          {loading ? (
            'Loading listings…'
          ) : (
            <>
              <span>No active listings yet — mint &amp; list some to try a buy.</span>
              <Link href="/seller" className="btn-primary">
                Go to Seller
              </Link>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((l) => {
          const inToken = currency !== 'XTZ' ? convert(l.priceMutez) : null;
          const isOwn = connected && l.seller === aw.michelsonOwner; // objkt blocks buying your own ask (M_NO_SELF_FULFILL)
          return (
            <div key={l.askId} className={`card flex flex-col p-3 ${pickerOpen === l.askId ? 'relative z-30' : ''}`}>
              <NftArt tokenId={l.tokenId} className="mb-3 h-28 w-full rounded-xl" />
              <div className="truncate text-sm font-medium">{nftName(l.tokenId)}</div>
              <div className="font-mono text-[11px] text-slate-500">
                #{short(l.tokenId, 5)} · ask {l.askId}
              </div>

              {/* card body shows the (short, stable) XTZ price; what you pay in the chosen token goes on the Buy button */}
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-lg font-semibold">{mutezToXtz(l.priceMutez, 6)}</span>
                <span className="text-xs text-slate-500">XTZ</span>
              </div>

              <div className="mt-auto pt-2 text-[11px] text-slate-600">
                seller {short(l.seller, 5)}
                {isOwn && <span className="ml-1 text-amber-400">· you</span>}
              </div>
              {isOwn ? (
                <button
                  disabled
                  title="objkt blocks buying your own listing (M_NO_SELF_FULFILL) — connect a different account to buy"
                  className="btn-primary mt-2 flex-col gap-0 py-2! leading-tight cursor-not-allowed opacity-50"
                >
                  <span>Your listing</span>
                  <span className="text-[11px] font-normal text-white/85">can’t buy your own</span>
                </button>
              ) : (
                <BuyButton
                  connected={connected}
                  onBuy={() => setSel(l)}
                  onOpenChange={(o) => setPickerOpen(o ? l.askId : null)}
                  sub={
                    token && currency !== 'XTZ' ? (
                      <span className="max-w-full truncate text-[11px] font-normal text-white/85">
                        ≈ {inToken === null ? '…' : fmtSig(inToken, token.decimals, 4)} {token.symbol}
                      </span>
                    ) : null
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      {sel && (
        <BuyModal
          listing={sel}
          onClose={() => {
            setSel(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
