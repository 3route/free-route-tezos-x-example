// Display formatting helpers.
export function fmtUnits(raw: bigint | string | number, decimals: number, maxFrac = 4): string {
  const v = typeof raw === 'bigint' ? raw : BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  if (frac === 0n) return whole.toString();
  const f = frac.toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  return f ? `${whole}.${f}` : whole.toString();
}

export const mutezToXtz = (mutez: bigint | string | number, maxFrac = 6): string => fmtUnits(mutez, 6, maxFrac);

// Inverse of fmtUnits: a human decimal string -> base units. Returns null for empty/invalid input.
export function parseUnits(human: string, decimals: number): bigint | null {
  if (human === '' || human === '.' || !/^\d*\.?\d*$/.test(human)) return null;
  const [whole, frac = ''] = human.split('.');
  const f = (frac + '0'.repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(f || '0');
  } catch {
    return null;
  }
}

// Significant-figure formatting — keeps small values readable instead of rounding to "0"
// (e.g. 0.00000185 VNXAU rather than 0.0000). `sig` = significant digits to keep.
export function fmtSig(raw: bigint | string | number, decimals: number, sig = 4): string {
  const v = typeof raw === 'bigint' ? raw : BigInt(raw);
  if (v === 0n) return '0';
  const num = Number(v) / 10 ** decimals;
  if (!isFinite(num) || num === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(num)));
  const dec = Math.min(18, Math.max(0, sig - 1 - exp));
  let out = num.toFixed(dec);
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  return out;
}

export function short(addr: string, n = 6): string {
  return addr.length > 2 * n ? `${addr.slice(0, n)}…${addr.slice(-4)}` : addr;
}

export const fmtTime = (ts: number): string => new Date(ts).toLocaleTimeString();
