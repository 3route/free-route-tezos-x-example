// Turn a thrown wallet / RPC error into a short, human-readable line. Wallets and ethers throw verbose multi-line
// dumps; Beacon (Temple) throws a non-Error object, and Taquito may wrap it as `new Error(obj)` whose message is the
// literal "[object Object]" with the original tucked under `.cause`. So we walk the error graph collecting strings.
export function txErrorMessage(e: unknown): string {
  const seen = new Set<unknown>();
  const strings: string[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (v == null || depth > 3 || seen.has(v)) return;
    if (typeof v === 'string') {
      if (v.trim()) strings.push(v);
      return;
    }
    if (typeof v !== 'object') return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const k of ['shortMessage', 'message', 'description', 'title', 'name', 'errorType']) {
      const s = o[k];
      if (typeof s === 'string' && s.trim()) strings.push(s);
    }
    for (const k of ['cause', 'error', 'originalError', 'data', 'innerError']) visit(o[k], depth + 1);
  };
  visit(e, 0);

  const code = (e as { code?: number | string } | null)?.code;
  const haystack = strings.join(' · ');
  // user declined the wallet prompt: MetaMask 4001 / ethers ACTION_REJECTED / Beacon abort (ABORTED_ERROR). Keep the
  // text match narrow (require "user …" or an explicit abort) so a contract revert containing "reject" isn't mislabelled.
  if (
    code === 4001 ||
    code === 'ACTION_REJECTED' ||
    /aborted by the user|user (rejected|denied|declined)|user reject|\baborted\b|ABORTED_ERROR|NotGranted/i.test(haystack)
  ) {
    return 'Signature rejected in the wallet.';
  }

  // first meaningful line — skip useless placeholders (stringified objects, generic Beacon error names)
  const first = strings.find((s) => s !== '[object Object]' && s !== 'UnknownBeaconError' && s !== 'BeaconError');
  const clean = (first ?? '').split('\n')[0].trim();
  if (!clean || clean === '[object Object]') return 'Transaction failed in the wallet.';
  return clean.length > 160 ? clean.slice(0, 160) + '…' : clean;
}
