// Treasury sweep: after claims and closes, collected USDC sits in the payee
// token account. This moves the surplus to a Bridge liquidation address.
//
// Bridge has no call here. A USDC transfer to that Solana address is the whole
// integration: Bridge converts it and deposits USD in AstroAm's bank, which
// backs the card Citrus auto-refills from. Citrus itself does not take crypto.
//
// The amount is chain-agnostic. SolanaEscrowChain and FakeEscrowChain both
// transfer exactly what `sweepAmount` returns, so a second pass with the same
// balance is a no-op (the float is already all that is left).

import { isSolanaAddress } from "../shared/solana/base58.ts";
import { usdcToSolanaAtomic } from "../shared/solana/amounts.ts";

/** Published Bridge minimum on Solana USDC → USD is about $1. */
export const TREASURY_SWEEP_MIN_USDC_DEFAULT = 1;
/** Left in the payee wallet. 0 sends every collected USDC above the minimum. */
export const TREASURY_FLOAT_USDC_DEFAULT = 0;

export type SweepResult = { txHash: string; amountAtomic: bigint };

export type TreasurySweepInput = {
  /** Bridge liquidation address (Solana). */
  to: string;
  /** Smallest transfer worth sending, atomic USDC (6 decimals). */
  minAtomic: bigint;
  /** Atomic USDC that stays in the payee wallet. */
  keepAtomic: bigint;
};

export interface TreasuryPort {
  /**
   * Moves payee USDC above the float to `to` when that amount reaches the
   * minimum. Null when there is nothing to send.
   */
  sweep(input: TreasurySweepInput): Promise<SweepResult | null>;
}

export type EnabledTreasury = {
  address: string;
  minAtomic: bigint;
  keepAtomic: bigint;
};

export type TreasuryConfig =
  | { enabled: false; reason: "unset" | "invalid_address" }
  | ({ enabled: true } & EnabledTreasury);

/**
 * Atomic USDC to transfer. Null when the surplus over the float is below the
 * minimum, which is also why repeating a sweep does not send twice.
 */
export function sweepAmount(balanceAtomic: bigint, input: { minAtomic: bigint; keepAtomic: bigint }): bigint | null {
  if (balanceAtomic < 0n || input.keepAtomic < 0n || input.minAtomic <= 0n) {
    throw new RangeError("sweepAmount: balance and float must be >= 0 and the minimum must be > 0");
  }
  if (balanceAtomic <= input.keepAtomic) return null;
  const movable = balanceAtomic - input.keepAtomic;
  if (movable < input.minAtomic) return null;
  return movable;
}

function parseUsdc(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function positiveUsdc(raw: string | undefined, fallback: number): bigint {
  const parsed = parseUsdc(raw);
  if (parsed === undefined || parsed <= 0) return usdcToSolanaAtomic(fallback);
  return usdcToSolanaAtomic(parsed);
}

function nonNegativeUsdc(raw: string | undefined, fallback: number): bigint {
  const parsed = parseUsdc(raw);
  if (parsed === undefined || parsed < 0) return usdcToSolanaAtomic(fallback);
  return usdcToSolanaAtomic(parsed);
}

/**
 * `BRIDGE_LIQUIDATION_ADDRESS` empty → the sweep is off and collected USDC
 * stays with the payee. A set but unusable address is also off: nothing is
 * sent to a destination that is not a Solana address.
 */
export function treasuryConfigFromEnv(env: Record<string, string | undefined>): TreasuryConfig {
  const address = env.BRIDGE_LIQUIDATION_ADDRESS?.trim() ?? "";
  if (address === "") return { enabled: false, reason: "unset" };
  if (!isSolanaAddress(address)) return { enabled: false, reason: "invalid_address" };
  return {
    enabled: true,
    address,
    minAtomic: positiveUsdc(env.TREASURY_SWEEP_MIN_USDC, TREASURY_SWEEP_MIN_USDC_DEFAULT),
    keepAtomic: nonNegativeUsdc(env.TREASURY_FLOAT_USDC, TREASURY_FLOAT_USDC_DEFAULT),
  };
}
