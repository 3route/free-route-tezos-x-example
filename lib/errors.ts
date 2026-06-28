// Turn a thrown wallet / RPC error into a short, human-readable line. Wallets and ethers throw verbose multi-line
// dumps (full calldata, payload, nested info) that we never want to render raw in the UI.
export function txErrorMessage(e: unknown): string {
  const err = e as { code?: number | string; shortMessage?: string; message?: string } | null | undefined;
  const code = err?.code;
  const message = err?.shortMessage ?? err?.message ?? String(e ?? '');
  // user declined the wallet prompt: MetaMask 4001 / ethers ACTION_REJECTED / Beacon abort. Keep the message
  // match narrow (require "user …" or an explicit abort) so a contract revert that merely contains "reject"
  // isn't mislabelled as a user rejection.
  if (code === 4001 || code === 'ACTION_REJECTED' || /user (rejected|denied|declined)|user reject|aborted/i.test(message)) {
    return 'Signature rejected in the wallet.';
  }
  const clean = message.split('\n')[0].trim(); // first line only, then cap the length
  return clean.length > 160 ? clean.slice(0, 160) + '…' : clean;
}
