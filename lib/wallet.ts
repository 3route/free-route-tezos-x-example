// Beacon (Temple) wallet connection + a TezosToolkit bound to it. Client-side only.
import { create } from 'zustand';
import { TezosToolkit } from '@taquito/taquito';
import { BeaconWallet } from '@taquito/beacon-wallet';
import { BeaconEvent, ColorMode } from '@airgap/beacon-dapp';
import { CFG, NETWORK_NAME } from './config';
import { michelsonToEvmAlias } from '@baking-bad/free-route-tezos-x';
import { setLastKind } from './activeKind';

interface WalletState {
  connected: boolean;
  michelsonAddress: string | null; // buyer/seller Michelson address (tz...)
  aliasAddress: string | null; // its derived EVM alias address (where ERC20s live)
  tezos: TezosToolkit | null;
  wallet: BeaconWallet | null;
  connecting: boolean;
  connect: () => Promise<void>;
  switchAccount: () => Promise<void>; // re-prompt the wallet to pick a (possibly different) account
  disconnect: () => Promise<void>;
  restore: () => Promise<void>; // rehydrate an existing Beacon session on page load
}

const bind = (wallet: BeaconWallet, michelsonAddress: string) => {
  const tezos = new TezosToolkit(CFG.tezRpc);
  tezos.setWalletProvider(wallet);
  tezos.setProvider({ config: { confirmationPollingTimeoutSecond: 30 } });
  return { connected: true, michelsonAddress, aliasAddress: michelsonToEvmAlias(michelsonAddress), tezos, wallet, connecting: false };
};

export const useWallet = create<WalletState>((set, get) => {
  // Taquito best practice: exactly ONE BeaconWallet app-wide (it owns a unique p2p connection — multiple instances
  // warn "you created multiple Beacon SDK Client instances"). Create it lazily, apply the metrics-bug workaround,
  // and subscribe to ACTIVE_ACCOUNT_SET once; connect / restore / switchAccount all reuse this instance.
  let singleton: BeaconWallet | null = null;
  const getWallet = (): BeaconWallet => {
    if (singleton) return singleton;
    const wallet = new BeaconWallet({
      name: 'objkt EVM-pay',
      // previewnet is a custom network for the wallet (set at instantiation, not in requestPermissions).
      network: { type: 'custom' as never, name: NETWORK_NAME, rpcUrl: CFG.tezRpc },
      colorMode: ColorMode.DARK, // match the dApp's dark theme in the Beacon pairing/permission UI
    });
    // Beacon (>=4.x) bug: even with metrics disabled, sendMetrics() fires a non-awaited updateMetricsStorage() that
    // does getAllKeys('metrics') on an IndexedDB store its own schema may not have created — throwing "metrics not
    // found" as an unhandled rejection during connect (non-fatal, but the Next dev overlay surfaces it). We don't
    // use metrics — no-op the method so it never touches that store.
    const client = wallet.client as unknown as { updateMetricsStorage?: (payload?: unknown) => Promise<void> };
    if (typeof client.updateMetricsStorage === 'function') client.updateMetricsStorage = async () => undefined;
    // Beacon >=4.2 needs an ACTIVE_ACCOUNT_SET subscription (else getActiveAccount warns); it also keeps our state
    // in sync if the active account changes/clears outside our own flow. Subscribed once, on the singleton.
    wallet.client.subscribeToEvent(BeaconEvent.ACTIVE_ACCOUNT_SET, (account) => {
      const address = account?.address ?? null;
      if (address === get().michelsonAddress) return; // already in sync (our connect/restore handled it)
      if (address) set(bind(wallet, address));
      else set({ connected: false, michelsonAddress: null, aliasAddress: null, tezos: null, wallet: null });
    });
    singleton = wallet;
    return wallet;
  };

  // Beacon's requestPermissions can hang (never reject) when the user closes the pairing/permission window —
  // unlike MetaMask, which rejects (4001). There's no clean cross-package way to hook the alert's close without
  // re-rendering it via @airgap's beacon-ui (which would drop the @ecadlabs dark theme), so as a safety we watch
  // for focus returning to the dApp while a request is still pending and drop `connecting` then (a late success
  // still binds normally). Returns a cleanup that removes the listener.
  const guardStuckConnecting = (): (() => void) => {
    if (typeof window === 'undefined') return () => undefined;
    const onFocus = () =>
      setTimeout(() => {
        if (get().connecting && !get().connected) set({ connecting: false });
      }, 800); // let a real success/rejection land first
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  };

  return {
    connected: false,
    michelsonAddress: null,
    aliasAddress: null,
    tezos: null,
    wallet: null,
    connecting: false,

    // Beacon persists the active account in localStorage; restore it without prompting on reload.
    restore: async () => {
      if (get().connected || get().connecting) return;
      try {
        const wallet = getWallet();
        const account = await wallet.client.getActiveAccount();
        if (!account) return;
        set(bind(wallet, account.address));
      } catch {
        /* no persisted session — stay disconnected */
      }
    },

    connect: async () => {
      if (get().connecting || get().connected) return;
      set({ connecting: true });
      const release = guardStuckConnecting();
      try {
        const wallet = getWallet();
        await wallet.requestPermissions();
        const michelsonAddress = await wallet.getPKH();
        set(bind(wallet, michelsonAddress));
        setLastKind('temple'); // user explicitly connected Temple → make it the active wallet on reload
      } catch (e) {
        set({ connecting: false });
        throw e;
      } finally {
        release();
      }
    },

    // Re-prompt without an explicit disconnect first: the wallet shows its account picker and replaces the
    // active account. On cancel the current account is kept (we never cleared it).
    switchAccount: async () => {
      if (get().connecting) return;
      set({ connecting: true });
      const release = guardStuckConnecting();
      try {
        const wallet = getWallet();
        await wallet.requestPermissions();
        const michelsonAddress = await wallet.getPKH();
        set(bind(wallet, michelsonAddress));
        setLastKind('temple');
      } catch {
        set({ connecting: false });
      } finally {
        release();
      }
    },

    disconnect: async () => {
      const w = get().wallet;
      // Tear down our state FIRST so the UI disconnects immediately — never gate it on Beacon's clearActiveAccount,
      // which can hang and would otherwise leave the dApp stuck "connected" to Temple. The singleton is kept for
      // a later reconnect (its one subscription stays live).
      set({ connected: false, michelsonAddress: null, aliasAddress: null, tezos: null, wallet: null });
      setLastKind(null); // forget the active-wallet preference (the other wallet, if any, becomes active)
      try {
        if (w) await w.clearActiveAccount();
      } catch {
        /* ignore — our state is already cleared */
      }
    },
  };
});
