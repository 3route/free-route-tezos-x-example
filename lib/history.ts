// Activity history — completed buy/swap/mint operations, with the full receipt data so the LogPanel can
// re-open the exact ReceiptModal/SwapReceiptModal/MintReceiptModal later. Persisted to localStorage
// (zustand persist) so it survives reloads; only the `clear` button wipes it.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { BuyReceipt, MintReceipt, SwapReceipt } from './receipt';
import type { FreeRouteToken } from '@baking-bad/free-route-tezos-x';

export type HistoryEntry =
  | { id: number; ts: number; kind: 'buy'; receipt: BuyReceipt; token: FreeRouteToken; tokenId: string }
  | { id: number; ts: number; kind: 'swap'; receipt: SwapReceipt }
  | { id: number; ts: number; kind: 'mint'; receipt: MintReceipt };

interface HistoryState {
  entries: HistoryEntry[]; // newest first
  addBuy: (receipt: BuyReceipt, token: FreeRouteToken, tokenId: string) => void;
  addSwap: (receipt: SwapReceipt) => void;
  addMint: (receipt: MintReceipt) => void;
  clear: () => void;
}

let seq = 0; // monotonic entry id; bumped past persisted entries on rehydrate so keys never collide

// Receipts hold bigint fields, which JSON can't serialize — tag them as {$b:"<digits>"} and revive back.
const noopStorage: Storage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
const storage = createJSONStorage<Pick<HistoryState, 'entries'>>(
  () => (typeof window !== 'undefined' ? window.localStorage : noopStorage),
  {
    replacer: (_k, v) => (typeof v === 'bigint' ? { $b: v.toString() } : v),
    reviver: (_k, v) => (v && typeof v === 'object' && '$b' in (v as object) ? BigInt((v as { $b: string }).$b) : v),
  },
);

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      entries: [],
      addBuy: (receipt, token, tokenId) => set((s) => ({ entries: [{ id: ++seq, ts: Date.now(), kind: 'buy', receipt, token, tokenId }, ...s.entries] })),
      addSwap: (receipt) => set((s) => ({ entries: [{ id: ++seq, ts: Date.now(), kind: 'swap', receipt }, ...s.entries] })),
      addMint: (receipt) => set((s) => ({ entries: [{ id: ++seq, ts: Date.now(), kind: 'mint', receipt }, ...s.entries] })),
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'free-route-activity', // localStorage key
      version: 1, // bump if a receipt shape changes; migrate drops incompatible old entries
      storage,
      partialize: (s) => ({ entries: s.entries }), // persist data only, not the action fns
      onRehydrateStorage: () => (state) => {
        if (state?.entries.length) seq = Math.max(...state.entries.map((e) => e.id));
      },
    },
  ),
);
