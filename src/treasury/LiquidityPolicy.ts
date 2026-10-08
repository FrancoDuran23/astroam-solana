// ASTROAM Liquidity Policy: Multi-tiered liquidity management & rebalancing.
//
// Multi-Tier Architecture:
// 1. Solana Treasury (Primary Treasury - bulk USDC reserves)
// 2. Polygon EOA (Transit / Settlement bridge destination)
// 3. ARQ Balance (Operational liquidity buffer)
// 4. Citrus Reseller Balance (Provider working balance)
//
// Rules:
// - All financial calculations use exclusively bigint atomic USDC units (6 decimals).
// - Solana is protected by keepTreasuryAtomic (never emptied below reserve).
// - Minimum transfer size enforced via minimumTransferAtomic.
// - Liquidity in-transit (pending CCTP or Polygon->ARQ transfers) is counted toward
//   effective operational liquidity to prevent duplicate rebalance operations.
// - Maximum transfer guard per operation prevents runaway calculations.

import type { TreasuryTransferRecord, TransferState } from "./TreasuryTransferStore.ts";
import { usdcToSolanaAtomic } from "../shared/solana/amounts.ts";

export type LiquidityConfig = {
  /** Minimum transfer size threshold (USDC atomic bigint). Default e.g. 5 USDC */
  minTransferAtomic: bigint;
  /** Reserve to keep in primary Solana treasury (USDC atomic bigint). Default e.g. 5 USDC */
  keepTreasuryAtomic: bigint;
  /** Target operational liquidity buffer in ARQ (USDC atomic bigint). Default e.g. 20 USDC */
  targetArqAtomic: bigint;
  /** Maximum operational buffer limit in ARQ (USDC atomic bigint). Default e.g. 100 USDC */
  maxArqAtomic: bigint;
  /** Citrus reseller target balance in atomic units. Default e.g. 10 USD */
  citrusTargetUsdAtomic: bigint;
  /** Citrus reseller minimum balance in atomic units. Default e.g. 2 USD */
  citrusMinUsdAtomic: bigint;
  /** Optional safety cap per single transfer (USDC atomic bigint). */
  maxTransferAtomic?: bigint;
};

export type DecideRebalanceParams = {
  /** Available balance in primary Solana treasury */
  treasuryBalanceAtomic: bigint;
  /** Confirmed operational balance in ARQ/Citrus */
  operationalBalanceAtomic: bigint;
  /** Total liquidity currently in transit (pending transfers) */
  inTransitAtomic: bigint;
  /** Minimum allowed transfer amount */
  minimumTransferAtomic: bigint;
  /** Target operational liquidity buffer requirement */
  targetOperationalAtomic: bigint;
  /** Mandatory reserve to retain in Solana treasury */
  keepTreasuryAtomic: bigint;
  /** Optional maximum transfer upper bound guard */
  maxTransferAtomic?: bigint;
  /** True if an active cross-chain transfer is currently executing */
  hasActiveTransfer?: boolean;
};

export type RebalanceDecisionReason =
  | "buffer_sufficient"
  | "below_minimum_transfer"
  | "treasury_reserve_protected"
  | "transfer_already_in_progress"
  | "exceeds_max_transfer_guard"
  | "rebalance_required"
  | "unknown_operational_balance";

export type RebalanceDecision = {
  shouldTransfer: boolean;
  amountAtomic: bigint;
  reason: RebalanceDecisionReason;
};

/**
 * Pure decision function for ASTROAM Liquidity Rebalancing.
 * All math is strictly bigint.
 */
export function decideRebalance(params: DecideRebalanceParams): RebalanceDecision {
  const {
    treasuryBalanceAtomic,
    operationalBalanceAtomic,
    inTransitAtomic,
    minimumTransferAtomic,
    targetOperationalAtomic,
    keepTreasuryAtomic,
    maxTransferAtomic,
    hasActiveTransfer,
  } = params;

  // 1. Duplicate active transfer guard
  if (hasActiveTransfer) {
    return {
      shouldTransfer: false,
      amountAtomic: 0n,
      reason: "transfer_already_in_progress",
    };
  }

  // 2. Calculate effective operational liquidity (confirmed + in-transit)
  const effectiveOperational = operationalBalanceAtomic + inTransitAtomic;

  // 3. Operational buffer sufficiency check
  if (effectiveOperational >= targetOperationalAtomic) {
    return {
      shouldTransfer: false,
      amountAtomic: 0n,
      reason: "buffer_sufficient",
    };
  }

  // 4. Calculate required deficit to reach target buffer
  const deficit = targetOperationalAtomic - effectiveOperational;

  // 5. Solana treasury reserve protection
  const availableSolana = treasuryBalanceAtomic > keepTreasuryAtomic
    ? treasuryBalanceAtomic - keepTreasuryAtomic
    : 0n;

  if (availableSolana === 0n) {
    return {
      shouldTransfer: false,
      amountAtomic: 0n,
      reason: "treasury_reserve_protected",
    };
  }

  // Amount to bridge is min(deficit, availableSolana)
  const amountToBridge = deficit < availableSolana ? deficit : availableSolana;

  // 6. Minimum transfer size check
  if (amountToBridge < minimumTransferAtomic) {
    return {
      shouldTransfer: false,
      amountAtomic: 0n,
      reason: "below_minimum_transfer",
    };
  }

  // 7. Maximum transfer safety cap guard
  if (maxTransferAtomic !== undefined && maxTransferAtomic > 0n && amountToBridge > maxTransferAtomic) {
    return {
      shouldTransfer: false,
      amountAtomic: 0n,
      reason: "exceeds_max_transfer_guard",
    };
  }

  // 8. Rebalance required
  return {
    shouldTransfer: true,
    amountAtomic: amountToBridge,
    reason: "rebalance_required",
  };
}

/**
 * Determines whether a transfer record represents liquidity in transit.
 * Liquidity is in-transit if the transfer is active and funds have left source
 * but have not yet been confirmed in destination ARQ balance.
 */
export function isTransferInTransit(record: TreasuryTransferRecord): boolean {
  const terminalStates: TransferState[] = [
    "completed",
    "arq_deposit_confirmed",
    "source_expired_unconfirmed",
    "source_quote_expired",
    "failed_terminal",
    "polygon_stuck",
  ];
  return !terminalStates.includes(record.state);
}

/**
 * Calculates total atomic USDC currently in transit across all active journal records.
 */
export function calculateInTransitLiquidityAtomic(records: TreasuryTransferRecord[]): bigint {
  return records
    .filter(isTransferInTransit)
    .reduce((sum, record) => sum + BigInt(record.amountAtomic), 0n);
}

/**
 * Parses liquidity configuration from environment variables with fail-hard validation.
 */
export function liquidityConfigFromEnv(env: Record<string, string | undefined>): LiquidityConfig {
  const parseUsdc = (key: string, defaultUsdc: number): bigint => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") return usdcToSolanaAtomic(defaultUsdc);
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error(`Invalid non-negative USDC configuration for ${key}: "${raw}"`);
    }
    return usdcToSolanaAtomic(num);
  };

  const minTransferAtomic = parseUsdc("TREASURY_MIN_TRANSFER_USDC", 5);
  const keepTreasuryAtomic = parseUsdc("TREASURY_KEEP_USDC", 5);
  const targetArqAtomic = parseUsdc("TREASURY_TARGET_ARQ_USDC", 20);
  const maxArqAtomic = parseUsdc("TREASURY_MAX_ARQ_USDC", 100);
  const citrusTargetUsdAtomic = parseUsdc("CITRUS_TARGET_BALANCE_USD", 10);
  const citrusMinUsdAtomic = parseUsdc("CITRUS_MIN_BALANCE_USD", 2);

  const rawMaxTransfer = env.TREASURY_MAX_TRANSFER_USDC;
  let maxTransferAtomic: bigint | undefined;
  if (rawMaxTransfer !== undefined && rawMaxTransfer.trim() !== "") {
    const num = Number(rawMaxTransfer);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error(`Invalid positive USDC configuration for TREASURY_MAX_TRANSFER_USDC: "${rawMaxTransfer}"`);
    }
    maxTransferAtomic = usdcToSolanaAtomic(num);
  }

  // Validation
  if (minTransferAtomic <= 0n) {
    throw new Error("TREASURY_MIN_TRANSFER_USDC must be greater than 0.");
  }
  if (maxArqAtomic < targetArqAtomic) {
    throw new Error("TREASURY_MAX_ARQ_USDC cannot be smaller than TREASURY_TARGET_ARQ_USDC.");
  }
  if (maxTransferAtomic !== undefined && maxTransferAtomic < minTransferAtomic) {
    throw new Error("TREASURY_MAX_TRANSFER_USDC cannot be smaller than TREASURY_MIN_TRANSFER_USDC.");
  }

  return {
    minTransferAtomic,
    keepTreasuryAtomic,
    targetArqAtomic,
    maxArqAtomic,
    citrusTargetUsdAtomic,
    citrusMinUsdAtomic,
    maxTransferAtomic,
  };
}
