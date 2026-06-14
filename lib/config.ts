// Previewnet wiring. All overridable via NEXT_PUBLIC_* but with working defaults.
export const CFG = {
  tezRpc: process.env.NEXT_PUBLIC_TEZ_RPC ?? 'https://michelson.previewnet.tezosx.nomadic-labs.com',
  evmRpc: process.env.NEXT_PUBLIC_EVM_RPC ?? 'https://evm.previewnet.tezosx.nomadic-labs.com',
  tzktApi: process.env.NEXT_PUBLIC_TZKT_API ?? 'https://api.previewnet.tezosx.tzkt.io/v1',
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 128064),
  gateway: process.env.NEXT_PUBLIC_GATEWAY ?? 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw',
  objkt: process.env.NEXT_PUBLIC_OBJKT ?? 'KT1AyJ5P4qRJZuHqXiR9QkKRuCy49yNyLVzo',
  fa2: process.env.NEXT_PUBLIC_FA2 ?? 'KT1TGSPo2Z8MJtCpNe2VmuuMaUJd8cbWLeLp',
  // ERC20 metadata standard; XTZ shown with 6 dec (mutez). 3route reports decimals per token too.
  explorer: 'https://previewnet.tezosx.tzkt.io', // tzkt — Michelson side (tz/KT addresses)
  evmExplorer: process.env.NEXT_PUBLIC_EVM_EXPLORER ?? 'https://blockscout.previewnet.tezosx.nomadic-labs.com', // Blockscout — EVM (0x) side
  faucet: process.env.NEXT_PUBLIC_FAUCET ?? 'https://faucet.previewnet.tezosx.nomadic-labs.com', // funds tz1 + 0x with testnet XTZ
} as const;

export const NETWORK_NAME = 'Tezos X Previewnet';
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% — initial value for the global slippage state (Uniswap/Pancake default)
