// Deterministic cosmetic names for tokens (the test FA2 stores no metadata, so names are derived
// from token_id — seller-set and buyer-view stay consistent).
const ADJ = ['Neon', 'Glitch', 'Quantum', 'Solar', 'Velvet', 'Pixel', 'Astral', 'Lunar', 'Hyper', 'Retro', 'Cyber', 'Prism'];
const NOUN = ['Fox', 'Wave', 'Orbit', 'Golem', 'Mirage', 'Sprite', 'Comet', 'Totem', 'Cipher', 'Drift', 'Nova', 'Relic'];

export function nftName(tokenId: number | string): string {
  const n = Number(BigInt(tokenId) % 1_000_000n);
  return `${ADJ[n % ADJ.length]} ${NOUN[Math.floor(n / ADJ.length) % NOUN.length]} #${n % 1000}`;
}

// A stable accent hue per token (for card art). Knuth-multiplicative hash so consecutive ids
// (timestamp-based mints) still spread across the whole hue wheel instead of clustering.
export function nftHue(tokenId: number | string): number {
  return Number((BigInt(tokenId) * 2654435761n) % 360n);
}
