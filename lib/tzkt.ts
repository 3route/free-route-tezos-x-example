// Read-only chain queries (tzkt + EVM RPC). No keys, no signing.
import { ethers } from 'ethers';
import { CFG } from './config';

export interface Listing {
  askId: string;
  tokenId: string;
  fa2: string;
  priceMutez: string;
  seller: string;
}

interface AskKey {
  key: string;
  value?: {
    token: { token_id: string; address: string };
    amount: string;
    creator: string;
    currency: Record<string, unknown>;
  };
}

// Active XTZ-priced asks on the objkt marketplace for our test FA2.
export async function fetchListings(): Promise<Listing[]> {
  const url = `${CFG.tzktApi}/contracts/${CFG.objkt}/bigmaps/asks/keys?active=true&value.token.address=${CFG.fa2}&limit=200&sort.desc=id`;
  const keys = (await fetch(url).then((r) => r.json()).catch(() => [])) as AskKey[];
  return keys
    .filter((k) => k.value && 'tez' in k.value.currency)
    .map((k) => ({
      askId: k.key,
      tokenId: k.value!.token.token_id,
      fa2: k.value!.token.address,
      priceMutez: k.value!.amount,
      seller: k.value!.creator,
    }));
}

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

// One shared EVM provider for all balance reads (avoids re-creating it per call).
let evmProvider: ethers.JsonRpcProvider | null = null;
const getEvmProvider = () => (evmProvider ??= new ethers.JsonRpcProvider(CFG.evmRpc, undefined, { batchMaxCount: 1 }));

export async function fetchErc20Balance(token: string, owner: string): Promise<bigint> {
  const c = new ethers.Contract(token, ERC20_ABI, getEvmProvider()) as unknown as { balanceOf(a: string): Promise<bigint> };
  return c.balanceOf(owner);
}

export async function fetchXtzBalance(michelsonAddress: string): Promise<bigint> {
  const b = await fetch(`${CFG.tezRpc}/chains/main/blocks/head/context/contracts/${michelsonAddress}/balance`).then((r) => r.json());
  return BigInt(b as string);
}

export async function fetchOwner(tokenId: string): Promise<string | null> {
  const k = (await fetch(`${CFG.tzktApi}/contracts/${CFG.fa2}/bigmaps/ledger/keys?key=${tokenId}`).then((r) => r.json()).catch(() => [])) as Array<{ value?: string }>;
  return k[0]?.value ?? null;
}

// The FA2's next_token_id counter — the id its next mint will assign. Used to predict ids for a
// mint batch (the contract, not the client, is the source of truth, so ids never collide).
// Throws on an unreadable counter: a silent 0 would make the seller list asks for the wrong tokens.
export async function fetchNextTokenId(): Promise<number> {
  const s = (await fetch(`${CFG.tzktApi}/contracts/${CFG.fa2}/storage`).then((r) => r.json())) as { next_token_id?: string };
  if (s?.next_token_id == null) throw new Error('could not read FA2 next_token_id');
  return Number(s.next_token_id);
}

export interface OwnedToken {
  tokenId: string;
}

// Tokens from the test FA2 currently owned by a Michelson address (ledger bigmap: token_id -> owner).
export async function fetchOwned(michelsonAddress: string): Promise<OwnedToken[]> {
  const url = `${CFG.tzktApi}/contracts/${CFG.fa2}/bigmaps/ledger/keys?value=${michelsonAddress}&active=true&limit=200&sort.desc=id`;
  const keys = (await fetch(url).then((r) => r.json()).catch(() => [])) as Array<{ key: string }>;
  return keys.map((k) => ({ tokenId: k.key }));
}
