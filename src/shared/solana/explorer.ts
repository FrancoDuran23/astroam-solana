import { SOLANA_CLUSTER, SOLANA_EXPLORER } from "./constants.ts";
import { isSolanaAddress, isSolanaSignature } from "./base58.ts";

export function solanaTxUrl(signature: string): string | null {
  if (!isSolanaSignature(signature)) return null;
  return `${SOLANA_EXPLORER}/tx/${signature}?cluster=${SOLANA_CLUSTER}`;
}

export function solanaAddressUrl(address: string): string | null {
  if (!isSolanaAddress(address)) return null;
  return `${SOLANA_EXPLORER}/address/${address}?cluster=${SOLANA_CLUSTER}`;
}
