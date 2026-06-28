'use client';
// Remembers which wallet the user last actively connected, so a reload restores THAT one as active even when
// both a Temple (Beacon) session and a MetaMask authorization persist. Set on explicit connect, cleared on
// disconnect; restore() never touches it. WalletKind lives here (a leaf module) to avoid an import cycle.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type WalletKind = 'temple' | 'metamask';

interface ActiveKindState {
  lastKind: WalletKind | null;
  setLastKind: (k: WalletKind | null) => void;
}

const noopStorage: Storage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };

export const useActiveKind = create<ActiveKindState>()(
  persist((set) => ({ lastKind: null, setLastKind: (lastKind) => set({ lastKind }) }), {
    name: 'free-route-active-wallet',
    storage: createJSONStorage(() => (typeof window !== 'undefined' ? window.localStorage : noopStorage)),
  }),
);

// Non-hook setter — called from inside the wallet stores (lib/wallet, lib/evmWallet).
export const setLastKind = (k: WalletKind | null) => useActiveKind.getState().setLastKind(k);
