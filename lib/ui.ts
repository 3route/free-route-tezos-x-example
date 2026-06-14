import { create } from 'zustand';
import { DEFAULT_SLIPPAGE_BPS } from './config';

interface UiState {
  bump: number; // increment to trigger a global data refresh (balances, listings)
  refresh: () => void;
  slippageBps: number; // global slippage tolerance — used for card pay-amounts and the buy
  setSlippageBps: (bps: number) => void;
  currency: string; // selected pay-token address ('' until tokens load; 'XTZ' = no conversion on the listing)
  setCurrency: (c: string) => void;
}

export const useUi = create<UiState>((set) => ({
  bump: 0,
  refresh: () => set((s) => ({ bump: s.bump + 1 })),
  slippageBps: DEFAULT_SLIPPAGE_BPS,
  setSlippageBps: (slippageBps) => set({ slippageBps }),
  currency: '',
  setCurrency: (currency) => set({ currency }),
}));
