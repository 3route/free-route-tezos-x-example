// Previewnet wiring. All overridable via NEXT_PUBLIC_* but with working defaults.
export const CFG = {
  tezRpc: process.env.NEXT_PUBLIC_TEZ_RPC ?? 'https://michelson.previewnet.tezosx.nomadic-labs.com',
  evmRpc: process.env.NEXT_PUBLIC_EVM_RPC ?? 'https://evm.previewnet.tezosx.nomadic-labs.com',
  tzktApi: process.env.NEXT_PUBLIC_TZKT_API ?? 'https://api.previewnet.tezosx.tzkt.io/v1',
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 128064),
  gateway: process.env.NEXT_PUBLIC_GATEWAY ?? 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw',
  objkt: process.env.NEXT_PUBLIC_OBJKT ?? 'KT1SkZH5zTjzcAeYvu874zHNmEDEcCVbUEx1',
  fa2: process.env.NEXT_PUBLIC_FA2 ?? 'KT1Nvifrp6um6xchvD2R68e8TALjH8KbdDt9',
  // ERC20 metadata standard; XTZ shown with 6 dec (mutez). free-route reports decimals per token too.
  explorer: process.env.NEXT_PUBLIC_EXPLORER ?? 'https://preview.previewnet.xtzkt.io', // 0xTzKT — both sides (tz/KT/0x addresses, Michelson ops + EVM txs)
  // Blockscout — only handed to MetaMask (wallet_addEthereumChain): the wallet builds /tx/<hash> and /address/<a> links itself.
  evmExplorer: process.env.NEXT_PUBLIC_EVM_EXPLORER ?? 'https://blockscout.previewnet.tezosx.nomadic-labs.com',
  faucet: process.env.NEXT_PUBLIC_FAUCET ?? 'https://faucet.previewnet.tezosx.nomadic-labs.com', // funds tz1 + 0x with testnet XTZ
} as const;

// 0xTzKT explorer routes — Michelson and EVM alike (an EVM tx hash works at /operations/<0x…>). The asset page (/assets/<KT1>/<id>) isn't live yet, so NFTs link to the FA2.
export const explorerAccount = (address: string) => `${CFG.explorer}/accounts/${address}`;
export const explorerOp = (opHash: string) => `${CFG.explorer}/operations/${opHash}`;
export const explorerNft = (contract: string, _tokenId: string | number) => explorerAccount(contract);

export const NETWORK_NAME = 'Tezos X Previewnet';
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% — initial value for the global slippage state (Uniswap/Pancake default)
