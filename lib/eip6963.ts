'use client';
// EIP-6963 multi-injected-provider discovery. When several wallet extensions are installed they fight over
// window.ethereum (e.g. Temple's EVM mode wins it), so calling window.ethereum reaches the wrong wallet. EIP-6963
// has each wallet announce its provider via an event, letting us target MetaMask (rdns "io.metamask") directly.
export type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
  isMetaMask?: boolean;
  providers?: Eip1193[]; // legacy multi-provider array some wallets expose on window.ethereum
};
interface ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193;
}

const registry = new Map<string, ProviderDetail>(); // rdns -> announced provider

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (event) => {
    const d = (event as CustomEvent<ProviderDetail>).detail;
    if (d?.info?.rdns) registry.set(d.info.rdns, d);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider')); // ask installed wallets to announce
}

const fromWindow = (): Eip1193 | null => {
  if (typeof window === 'undefined') return null;
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) return null;
  if (eth.providers?.length) return eth.providers.find((p) => p.isMetaMask) ?? eth.providers[0]; // legacy
  return eth;
};

// The injected MetaMask provider, preferring EIP-6963 (robust against window.ethereum being hijacked).
export function getMetaMaskProvider(): Eip1193 | null {
  const exact = registry.get('io.metamask')?.provider;
  if (exact) return exact;
  for (const d of registry.values()) if (d.info.rdns.toLowerCase().includes('metamask')) return d.provider;
  const w = fromWindow();
  return w?.isMetaMask ? w : null; // last resort: only window.ethereum if it's MetaMask — never hand back another wallet
}

// Wait briefly for MetaMask to announce — extensions respond to requestProvider asynchronously, and on a reload
// the announcement can land after mount.
export function waitForMetaMask(timeoutMs = 3000): Promise<Eip1193 | null> {
  return new Promise((resolve) => {
    if (registry.get('io.metamask')) return resolve(getMetaMaskProvider());
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('eip6963:requestProvider'));
    const start = Date.now();
    const id = setInterval(() => {
      if (registry.get('io.metamask') || Date.now() - start > timeoutMs) {
        clearInterval(id);
        resolve(getMetaMaskProvider());
      }
    }, 150);
  });
}
