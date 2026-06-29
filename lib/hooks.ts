'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { XTZ_ADDRESS, isXtz, xtzMutezToWei } from '@baking-bad/free-route-tezos-x';
import type { FreeRouteToken } from '@baking-bad/free-route-tezos-x';
import { freeRoute } from './freeRoute';
import { fetchErc20Balance, fetchEvmXtzBalance, fetchListings, fetchOwned, fetchXtzBalance, type Listing, type OwnedToken } from './tzkt';
import { useUi } from './ui';
import { fmtSig } from './format';
import type { WalletKind } from './account';

// free-route token registry (payment options live here).
export function useTokens() {
  const [tokens, setTokens] = useState<FreeRouteToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    freeRoute
      .getTokens()
      // stable, deterministic order — the server returns tokens in an arbitrary (map) order that
      // varies per fetch, and each useTokens() instance fetches independently. Sort by symbol so the
      // list looks identical everywhere and across reloads.
      .then((t) => setTokens([...t].sort((a, b) => a.symbol.localeCompare(b.symbol))))
      .catch((e: Error) => setError(e.message));
  }, []);
  // payment/quote tokens = real ERC20s: drop the native-XTZ registry entry (the native currency itself —
  // redundant with the XTZ option / pointless to swap XTZ->XTZ). Memoized so its identity is stable across
  // renders — otherwise dependent effects (balances, rate) would refetch on every render.
  const payTokens = useMemo(() => tokens.filter((t) => !isXtz(t.address)), [tokens]);
  return { tokens, payTokens, error };
}

// ---- Global balances: ONE shared source of truth, polled on an interval ----
// Michelson-address XTZ balance + alias ERC20 balances, held in a module store so WalletMenu and the buy modal
// read the SAME values (no duplicate fetching). A single useBalancesSync mount keeps them fresh.
interface BalancesState {
  xtz: bigint | null; // Michelson-address XTZ (mutez)
  erc: Record<string, bigint>; // alias ERC20 balances, keyed by token address
  loading: boolean;
  updatedAt: number | null;
  apply: (p: Partial<Pick<BalancesState, 'xtz' | 'erc' | 'loading' | 'updatedAt'>>) => void;
}
const useBalancesStore = create<BalancesState>((set) => ({
  xtz: null,
  erc: {},
  loading: false,
  updatedAt: null,
  apply: (p) => set(p),
}));

export const BALANCES_REFRESH_MS = 30_000; // same cadence as the rate quote and the buy re-quote

// Mount ONCE (top-level) with the active wallet's identities + pay tokens. Fetches now, on every global bump
// (refresh), and every 30s; writes into the shared store. No-op until the addresses and the token list exist.
// ERC20s always live on the EVM side under `evmPayer` (Temple: the Michelson alias; MetaMask: the 0x account);
// XTZ is the Michelson-account balance for Temple, the EVM-account gas balance for MetaMask.
export function useBalancesSync(kind: WalletKind | null, evmPayer: string | null, michelsonAddress: string | null, payTokens: FreeRouteToken[]) {
  const apply = useBalancesStore((s) => s.apply);
  const bump = useUi((s) => s.bump);
  useEffect(() => {
    if (!evmPayer || !payTokens.length) return;
    let cancelled = false;
    const fetchAll = async () => {
      apply({ loading: true });
      try {
        const xtzP =
          kind === 'metamask' ? fetchEvmXtzBalance(evmPayer).catch(() => 0n) : michelsonAddress ? fetchXtzBalance(michelsonAddress).catch(() => 0n) : Promise.resolve(0n);
        const [xtz, entries] = await Promise.all([
          xtzP,
          Promise.all(payTokens.map(async (t) => [t.address, await fetchErc20Balance(t.address, evmPayer).catch(() => 0n)] as const)),
        ]);
        if (!cancelled) apply({ xtz, erc: Object.fromEntries(entries), updatedAt: Date.now() });
      } finally {
        if (!cancelled) apply({ loading: false });
      }
    };
    void fetchAll();
    const id = setInterval(fetchAll, BALANCES_REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void fetchAll(); // refresh when the tab regains focus
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, evmPayer, michelsonAddress, payTokens, bump]);
}

// Read the shared balances. `refresh` triggers a global bump, which re-runs useBalancesSync.
export function useBalances() {
  const xtz = useBalancesStore((s) => s.xtz);
  const erc = useBalancesStore((s) => s.erc);
  const loading = useBalancesStore((s) => s.loading);
  const updatedAt = useBalancesStore((s) => s.updatedAt);
  const refresh = useUi((s) => s.refresh);
  return { xtz, erc, loading, updatedAt, refresh };
}

// Live price-currency converter. Pulls ONE exact-out rate (token per 1 XTZ) and applies it to every listing;
// auto-refreshes every 30s. currency 'XTZ' = no conversion.
const REF_XTZ_MUTEZ = 1_000_000n; // 1 XTZ — the rate is normalized to this
// The rate must be the BUY direction (token -> XTZ, what the modal pays), not the reverse — on thin previewnet
// pools the two differ by the spread. exact-out CAN'T route a full 1 XTZ there (quote_not_found / HTTP 400), so we
// probe a small target and scale linearly. The card price is an estimate anyway; the binding amount is the modal.
const PROBE_XTZ_MUTEZ = 50_000n; // 0.05 XTZ — small enough to route, close to the listing-price scale
const PROBE_XTZ_WEI = xtzMutezToWei(PROBE_XTZ_MUTEZ);

export function usePriceCurrency(payTokens: FreeRouteToken[]) {
  const currency = useUi((s) => s.currency); // global — shared with the buy modal
  const setCurrency = useUi((s) => s.setCurrency);
  const [rate, setRate] = useState<bigint | null>(null); // token base units per 1 XTZ
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = payTokens.find((t) => t.address === currency) ?? null;

  // default to the first pay-token once the registry loads (runs once; user can switch / toggle to XTZ after)
  useEffect(() => {
    if (!currency && payTokens.length) setCurrency(payTokens[0].address);
  }, [currency, payTokens]);

  useEffect(() => {
    if (!token) {
      setRate(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const fetchRate = async () => {
      try {
        // a rate quote needs no address — from/receiver are optional on getQuote. Small exact-out probe in the BUY
        // direction (token -> XTZ — what the modal pays), scaled to 1 XTZ (see PROBE_XTZ_MUTEZ above).
        const q = await freeRoute.getQuote({ src: token.address, dst: XTZ_ADDRESS, amount: PROBE_XTZ_WEI, isExactOut: true });
        if (!cancelled) {
          setRate((q.srcAmount * REF_XTZ_MUTEZ) / PROBE_XTZ_MUTEZ); // token base units per 1 XTZ (buy direction)
          setUpdatedAt(Date.now());
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void fetchRate();
    const id = setInterval(fetchRate, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  // listing price (mutez) -> selected token base units, at the shared rate only (NO slippage buffer). The card
  // is an estimate; the binding amount (with the slippage buffer + a real per-ask getSwap) lives in the modal.
  const convert = (priceMutez: string | number): bigint | null => {
    if (!token || rate === null) return null;
    return (BigInt(priceMutez) * rate) / REF_XTZ_MUTEZ;
  };

  // bidirectional rate label: "1 XTZ ≈ x SYM · 1 SYM ≈ y XTZ"
  let rateLabel: string | null = null;
  if (token && rate !== null && rate > 0n) {
    const xtzToToken = fmtSig(rate, token.decimals, 4); // SYM per 1 XTZ
    const tokenToXtzMutez = (REF_XTZ_MUTEZ * 10n ** BigInt(token.decimals)) / rate; // mutez per 1 SYM
    rateLabel = `1 XTZ ≈ ${xtzToToken} ${token.symbol} · 1 ${token.symbol} ≈ ${fmtSig(tokenToXtzMutez, 6, 4)} XTZ`;
  }

  return { currency, setCurrency, token, rate, convert, rateLabel, updatedAt, error };
}

// Active XTZ-priced listings for the test FA2.
export function useListings() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const bump = useUi((s) => s.bump);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setListings(await fetchListings());
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { listings, loading, refresh };
}

// Tokens owned by the connected Michelson address.
export function useOwned(michelsonAddress: string | null) {
  const [owned, setOwned] = useState<OwnedToken[]>([]);
  const [loading, setLoading] = useState(false);
  const bump = useUi((s) => s.bump);
  const refresh = useCallback(async () => {
    if (!michelsonAddress) {
      setOwned([]);
      return;
    }
    setLoading(true);
    try {
      setOwned(await fetchOwned(michelsonAddress));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [michelsonAddress, bump]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { owned, loading, refresh };
}
