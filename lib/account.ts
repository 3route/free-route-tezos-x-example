'use client';
// Unified view over the two signing directions — Temple (Michelson, lib/wallet) and MetaMask (EVM, lib/evmWallet).
// The UI reads identities/connection from here and branches on `kind` only where the signing actually differs
// (build Michelson ops + tezos.wallet.batch  vs  build EvmTxRequest[] + evmWallet.sendCalls).
import { useWallet } from './wallet';
import { useEvmWallet } from './evmWallet';
import { useActiveKind, type WalletKind } from './activeKind';

export type { WalletKind } from './activeKind';

export function useActiveWallet() {
  const temple = useWallet();
  const evm = useEvmWallet();
  const lastKind = useActiveKind((s) => s.lastKind);

  // Resolve the active wallet: prefer the last one the user explicitly connected (persisted), else whichever is
  // connected. This keeps MetaMask active after a reload even when a Temple/Beacon session also rehydrated.
  const connectedKinds: WalletKind[] = [];
  if (temple.connected) connectedKinds.push('temple');
  if (evm.connected) connectedKinds.push('metamask');
  const kind: WalletKind | null = (lastKind && connectedKinds.includes(lastKind) ? lastKind : connectedKinds[0]) ?? null;

  return {
    kind,
    connected: kind !== null,
    connecting: temple.connecting || evm.connecting,

    // EVM identity that holds the ERC20s and runs swaps (getSwap from/receiver):
    //   temple   → the Michelson account's EVM alias
    //   metamask → the 0x account itself
    evmPayer: kind === 'metamask' ? evm.evmAddress : temple.aliasAddress,

    // Michelson identity that owns bought NFTs / receives native XTZ:
    //   temple   → the tz1 account
    //   metamask → the 0x account's KT1 alias
    michelsonOwner: kind === 'metamask' ? evm.aliasAddress : temple.michelsonAddress,

    // Primary address to show in the header for this wallet.
    displayAddress: kind === 'metamask' ? evm.evmAddress : temple.michelsonAddress,

    temple,
    evm,
    disconnect: () => (kind === 'metamask' ? evm.disconnect() : void temple.disconnect()),
  };
}
