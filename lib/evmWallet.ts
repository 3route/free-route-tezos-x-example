'use client';
// MetaMask (EVM) wallet — the second signing direction, mirror of lib/wallet.ts (Beacon/Temple). The "evm account":
// its 0x holds the ERC20s and runs swaps; its "michelson alias" (KT1, evmToMichelsonAlias) is where NFTs land.
// The SDK's evm builders return EvmTxRequest[]; we send them atomically via EIP-5792 wallet_sendCalls, falling
// back to sequential eth_sendTransaction for wallets/chains without atomic batching.
import { create } from 'zustand';
import { ethers } from 'ethers';
import { evmToMichelsonAlias } from '@baking-bad/free-route-tezos-x';
import type { EvmTxRequest } from '@baking-bad/free-route-tezos-x';
import { setLastKind } from './activeKind';
import { CFG, NETWORK_NAME } from './config';
import { getMetaMaskProvider, waitForMetaMask, type Eip1193 } from './eip6963';

const CHAIN_ID = 128064; // Tezos X previewnet (EVM)
const CHAIN_ID_HEX = '0x' + CHAIN_ID.toString(16);
const toHex = (v: bigint) => '0x' + v.toString(16);

// How a batch was actually sent: one atomic EIP-5792 call, or a per-tx sequential fallback. The UI branches its
// copy/labels on this (a single atomic tx hash vs one hash per op).
export type SendMode = 'batch' | 'sequential';
export interface SendCallsResult {
  hashes: string[];
  mode: SendMode;
}

interface EvmWalletState {
  connected: boolean;
  evmAddress: string | null; // the 0x account (holds ERC20s, pays gas)
  aliasAddress: string | null; // its michelson alias (KT1) — where bought/minted NFTs land
  atomicBatch: boolean; // EIP-5792 wallet_getCapabilities: does the wallet report atomic batching for this chain?
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  restore: () => Promise<void>; // re-hydrate an already-authorized account on load (no prompt)
  switchAccount: () => Promise<void>; // re-prompt MetaMask's account picker to switch the active account
  /**
   * Send EvmTxRequest[] — one atomic EIP-5792 batch, or a sequential fallback. Returns the tx hashes + which
   * path was taken. `onStep(i, total)` fires before each prompt on the SEQUENTIAL path so the UI can highlight
   * which call (approve / reset / swap / fulfill) is being signed; it never fires on the batch (single-prompt) path.
   */
  sendCalls: (txs: readonly EvmTxRequest[], onStep?: (index: number, total: number) => void) => Promise<SendCallsResult>;
}

// The MetaMask provider specifically (via EIP-6963), not whatever wallet happens to own window.ethereum (Temple's
// EVM mode hijacks it). Throws if MetaMask isn't installed/enabled for this site.
const eip1193 = (): Eip1193 => {
  const eth = getMetaMaskProvider();
  if (!eth) throw new Error('MetaMask not found — install it, or enable it for this site');
  return eth;
};

// Ensure the wallet is on Tezos X previewnet; add the chain if the wallet doesn't know it yet (4902).
async function ensureChain(eth: Eip1193): Promise<void> {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: NETWORK_NAME,
          nativeCurrency: { name: 'Tez', symbol: 'XTZ', decimals: 18 },
          rpcUrls: [CFG.evmRpc],
          blockExplorerUrls: [CFG.evmExplorer],
        },
      ],
    });
  }
}

// EIP-5792 capability probe: does the wallet report atomic batching for our chain? Used only to drive UI copy
// (the actual send still tries wallet_sendCalls and falls back). Older wallets lack the method → treat as false.
async function probeAtomicBatch(eth: Eip1193, from: string): Promise<boolean> {
  try {
    const caps = (await eth.request({ method: 'wallet_getCapabilities', params: [from, [CHAIN_ID_HEX]] })) as
      | Record<string, { atomic?: { status?: string } }>
      | undefined;
    const status = caps?.[CHAIN_ID_HEX]?.atomic?.status;
    return status === 'supported' || status === 'ready';
  } catch {
    return false; // method not supported / older wallet → assume sequential
  }
}

const isUnsupported = (e: unknown): boolean => {
  const code = (e as { code?: number }).code;
  return code === 4200 || code === -32601 || code === -32602; // method not supported / not found / bad params
};

const isUserRejection = (e: unknown): boolean => {
  const code = (e as { code?: number | string }).code;
  return code === 4001 || code === 'ACTION_REJECTED'; // user closed/declined the wallet prompt
};

// EIP-5792: poll wallet_getCallsStatus until the batch settles; return the per-call tx hashes.
async function waitForCalls(eth: Eip1193, id: string): Promise<string[]> {
  for (let i = 0; i < 120; i++) {
    const res = (await eth.request({ method: 'wallet_getCallsStatus', params: [id] })) as {
      status?: number | string;
      receipts?: { transactionHash: string; status?: string | number }[];
    } | null;
    const status = res?.status;
    // EIP-5792 numeric codes: 100 pending, 200 confirmed, 400 failed-offchain, 500 reverted. Check FAILURE before
    // success so a 4xx/5xx isn't swallowed by a broad ">= 200" and mis-reported as a confirmed (empty) batch.
    if (status === 'FAILED' || (typeof status === 'number' && status >= 400)) throw new Error('EVM batch failed');
    if (status === 'CONFIRMED' || status === 200) {
      const receipts = res?.receipts ?? [];
      for (const r of receipts) {
        const ok = r.status === 'SUCCESS' || r.status === '0x1' || r.status === 1;
        if (!ok) throw new Error(`EVM batch reverted: ${r.transactionHash}`);
      }
      return receipts.map((r) => r.transactionHash);
    }
    await new Promise((r) => setTimeout(r, 1500)); // pending → keep polling
  }
  throw new Error('EVM batch timed out');
}

export const useEvmWallet = create<EvmWalletState>((set, get) => {
  // Keep state in sync with the wallet's account/chain changes — wired once per provider and torn down on
  // disconnect, so handlers can't stack (connect + restore touch the same MetaMask singleton) or resurrect
  // state after the user disconnects.
  let wired: Eip1193 | null = null;
  let onAccounts: ((...args: never[]) => void) | null = null;
  let onChain: (() => void) | null = null;

  const unwireEvents = () => {
    if (wired && onAccounts) wired.removeListener?.('accountsChanged', onAccounts);
    if (wired && onChain) wired.removeListener?.('chainChanged', onChain);
    wired = onAccounts = onChain = null;
  };

  const wireEvents = (eth: Eip1193) => {
    if (wired === eth) return; // already wired to this provider — don't stack listeners
    unwireEvents();
    onAccounts = (...args: never[]) => {
      const addr = (args[0] as string[] | undefined)?.[0] ?? null;
      if (addr) set({ connected: true, evmAddress: addr, aliasAddress: evmToMichelsonAlias(addr) });
      else set({ connected: false, evmAddress: null, aliasAddress: null });
    };
    onChain = () => void ensureChain(eth).catch(() => undefined);
    eth.on?.('accountsChanged', onAccounts);
    eth.on?.('chainChanged', onChain);
    wired = eth;
  };

  const bind = (address: string) => ({
    connected: true,
    evmAddress: address,
    aliasAddress: evmToMichelsonAlias(address),
    connecting: false,
  });

  // probe EIP-5792 atomic-batch capability for the current account (fire-and-forget; only drives UI copy)
  const refreshAtomic = (eth: Eip1193, address: string) =>
    void probeAtomicBatch(eth, address).then((atomicBatch) => set({ atomicBatch }));

  return {
    connected: false,
    evmAddress: null,
    aliasAddress: null,
    atomicBatch: false,
    connecting: false,

    restore: async () => {
      if (get().connected || get().connecting) return;
      try {
        const eth = await waitForMetaMask(); // MetaMask announces (EIP-6963) async after mount — wait for it
        if (!eth) return;
        const accounts = (await eth.request({ method: 'eth_accounts' })) as string[]; // no prompt — already-authorized only
        if (!accounts?.length) return;
        wireEvents(eth);
        set(bind(accounts[0]));
        refreshAtomic(eth, accounts[0]);
      } catch {
        /* stay disconnected */
      }
    },

    connect: async () => {
      if (get().connecting || get().connected) return;
      set({ connecting: true });
      try {
        const eth = eip1193();
        // Force MetaMask's account-picker popup even if the site is already authorized — EIP-1193 has no real
        // "disconnect", so eth_requestAccounts alone would reconnect silently. wallet_requestPermissions always
        // prompts (and lets the user switch accounts). Falls back if the wallet doesn't support it.
        try {
          await eth.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
        } catch (e) {
          if (!isUnsupported(e)) throw e; // a rejection (user closed the popup) aborts the connect
        }
        const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
        if (!accounts?.length) throw new Error('No account selected');
        await ensureChain(eth);
        wireEvents(eth);
        set(bind(accounts[0]));
        refreshAtomic(eth, accounts[0]);
        setLastKind('metamask'); // user explicitly connected MetaMask → make it the active wallet on reload
      } catch (e) {
        set({ connecting: false });
        throw e;
      }
    },

    // Re-open MetaMask's account picker mid-session to switch the active account (mirror of Temple's switchAccount).
    // Same wallet_requestPermissions prompt connect uses — but without the already-connected guard.
    switchAccount: async () => {
      if (!get().connected || get().connecting) return;
      set({ connecting: true });
      try {
        const eth = eip1193();
        try {
          await eth.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
        } catch (e) {
          if (!isUnsupported(e)) throw e; // a rejection (user closed the popup) aborts the switch
        }
        const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
        if (!accounts?.length) throw new Error('No account selected');
        wireEvents(eth); // no-op if already wired to this provider
        set(bind(accounts[0]));
        refreshAtomic(eth, accounts[0]);
      } catch (e) {
        set({ connecting: false });
        throw e;
      }
    },

    disconnect: () => {
      unwireEvents(); // drop the wallet event handlers so a later accountsChanged can't resurrect state
      set({ connected: false, evmAddress: null, aliasAddress: null, atomicBatch: false });
      setLastKind(null); // forget the active-wallet preference (the other wallet, if any, becomes active)
    },

    sendCalls: async (txs, onStep) => {
      const eth = eip1193();
      const from = get().evmAddress;
      if (!from) throw new Error('Connect MetaMask first');
      await ensureChain(eth);
      // Try an EIP-5792 batch first; fall back to sequential when the wallet/chain can't batch. Tezos X previewnet
      // has no EIP-7702, so MetaMask's atomic wallet_sendCalls errors there — we catch it and send sequentially.
      try {
        const calls = txs.map((t) => ({ to: t.to, data: t.data, value: toHex(t.value) }));
        const res = await eth.request({
          method: 'wallet_sendCalls',
          params: [{ version: '2.0.0', from, chainId: CHAIN_ID_HEX, atomicRequired: false, calls }],
        });
        const id = typeof res === 'string' ? res : (res as { id: string }).id;
        return { hashes: await waitForCalls(eth, id), mode: 'batch' };
      } catch (e) {
        if (isUserRejection(e)) throw e; // user declined — don't silently re-send via the fallback
        // any other failure (5792 unsupported, EIP-7702 / atomic batch not supported on this chain, …) → sequential
        const signer = await new ethers.BrowserProvider(eth).getSigner();
        const hashes: string[] = [];
        for (let i = 0; i < txs.length; i++) {
          onStep?.(i, txs.length); // tell the UI which call is about to be signed
          const t = txs[i];
          const sent = await signer.sendTransaction({ to: t.to, data: t.data, value: t.value });
          const receipt = await sent.wait();
          if (!receipt || receipt.status !== 1) throw new Error(`EVM tx reverted: ${sent.hash}`);
          hashes.push(sent.hash);
        }
        return { hashes, mode: 'sequential' };
      }
    },
  };
});
