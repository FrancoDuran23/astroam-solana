// Solana devnet rail. Colosseum (this repo is for the Colosseum / Superteam
// Argentina track) reviews working Solana products on devnet: that is the
// cluster a judge's Phantom can point at, and the one with a public faucet.
// Solana testnet is a different cluster and does not carry Circle's published
// USDC mint. Mainnet is out of scope.
//
// Circle publishes this mint for Solana devnet:
// https://developers.circle.com/stablecoins/usdc-contract-addresses
// getAccountInfo on https://api.devnet.solana.com returned an 82-byte account
// owned by TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (classic SPL Token).
// Byte 44 of a mint is decimals; it is 6. Byte 45 (is_initialized) is 1.
// The mint account does not store a symbol. Circle's docs name this mint USDC.
//
// Stellar USDC in the original app is 7 decimals (1 raw = 1e-7). Do not reuse
// those raw amounts as the atomic unit of this token.

export const SOLANA_CLUSTER = "devnet" as const;
export const SOLANA_RPC_URL = "https://api.devnet.solana.com" as const;
export const SOLANA_EXPLORER = "https://explorer.solana.com" as const;
export const SOLANA_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as const;
export const SOLANA_USDC_DECIMALS = 6 as const;
export const STELLAR_USDC_DECIMALS = 7 as const;
export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as const;
export const DEFAULT_ESCROW_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;

/** Same bytes as `VOUCHER_PREFIX` in programs/astroam-escrow/src/lib.rs. */
export const VOUCHER_PREFIX = "AstroAmEscrow:v1:close";
