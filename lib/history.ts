// Activity history — completed buy/swap/mint operations, with the full receipt data so the LogPanel can
// re-open the exact ReceiptModal/SwapReceiptModal/MintReceiptModal later. In-memory (zustand); resets on reload — that's fine.
import { create } from 'zustand';
import type { BuyReceipt, MintReceipt, SwapReceipt } from './receipt';
import type { FreeRouteToken } from './sdk';

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

let seq = 0;
export const useHistory = create<HistoryState>((set) => ({
  entries: [],
  addBuy: (receipt, token, tokenId) => set((s) => ({ entries: [{ id: ++seq, ts: Date.now(), kind: 'buy', receipt, token, tokenId }, ...s.entries] })),
  addSwap: (receipt) => set((s) => ({ entries: [{ id: ++seq, ts: Date.now(), kind: 'swap', receipt }, ...s.entries] })),
  addMint: (receipt) => set((s) => ({ entries: [{ id: ++seq, ts: Date.now(), kind: 'mint', receipt }, ...s.entries] })),
  clear: () => set({ entries: [] }),
}));
