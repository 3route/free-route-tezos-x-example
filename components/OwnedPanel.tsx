'use client';
import { useOwned } from '@/lib/hooks';
import { useActiveWallet } from '@/lib/account';
import { nftName } from '@/lib/names';
import { short } from '@/lib/format';
import { CFG } from '@/lib/config';
import { NftArt } from './NftArt';

export function OwnedPanel() {
  const aw = useActiveWallet();
  // NFTs are owned on the Michelson side: the tz1 (Temple) or the EVM account's KT1 alias (MetaMask).
  const { owned, loading, refresh } = useOwned(aw.michelsonOwner);

  if (!aw.connected) {
    return <div className="card text-sm text-slate-500">Connect a wallet to see the NFTs you own.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          My NFTs <span className="ml-1 text-sm text-slate-500">{owned.length}</span>
        </h2>
        <button className="btn-ghost" onClick={() => void refresh()}>
          ↻ Refresh
        </button>
      </div>

      {owned.length === 0 && (
        <div className="card text-sm text-slate-500">
          {loading ? 'Loading your NFTs…' : "You don't own any NFTs from this collection yet — buy one in Buyer mode."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {owned.map((o) => (
          <div key={o.tokenId} className="card flex flex-col p-3">
            <NftArt tokenId={o.tokenId} className="mb-3 h-28 w-full rounded-xl" />
            <div className="truncate text-sm font-medium">{nftName(o.tokenId)}</div>
            <div className="font-mono text-[11px] text-slate-500">#{short(o.tokenId, 6)}</div>
            <div className="mt-2">
              <span className="chip text-accent2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent2" /> owned
              </span>
            </div>
            <a
              href={`${CFG.explorer}/${CFG.fa2}/tokens/${o.tokenId}/transfers`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 text-xs text-accent hover:underline"
            >
              view on explorer ↗
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
