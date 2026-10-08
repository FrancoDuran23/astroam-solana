// TreasuryRouter: what fund-flow calls to move collected USDC out of the
// payee wallet. fund-flow says `rebalance(available)` and never knows how
// the money gets to its final destination.
//
// Implementations:
// - DisabledTreasury: does nothing (default, safe);
// - FakeTreasury: in-memory double for tests and demos;
// - CctpArqTreasury: burns USDC on Solana via CCTP, mints native USDC on
//   Polygon, sends it to the ARQ deposit address. (See CctpArqTreasury.ts)

export type RebalanceInput = {
  /** USDC the payee currently holds, atomic units (6 decimals). */
  availableAtomic: bigint;
};

export type RebalanceResult =
  | { moved: false; reason: string }
  | { moved: true; amountAtomic: bigint; txHash: string; detail?: string };

/**
 * The single method fund-flow calls after advancing every trip.
 * Implementations decide *when* and *how much* to move.
 */
export interface TreasuryRouter {
  readonly mode: string;
  rebalance(input: RebalanceInput): Promise<RebalanceResult>;
}

// ---------------------------------------------------------------------------
// DisabledTreasury — default: collected USDC stays with the payee.
// ---------------------------------------------------------------------------

export class DisabledTreasury implements TreasuryRouter {
  readonly mode = "disabled";
  async rebalance(_input: RebalanceInput): Promise<RebalanceResult> {
    return { moved: false, reason: "treasury_disabled" };
  }
}

// ---------------------------------------------------------------------------
// FakeTreasury — in-memory double for tests and demos.
// ---------------------------------------------------------------------------

export type FakeTreasuryOptions = {
  minTransferAtomic: bigint;
  targetBufferAtomic: bigint;
  keepAtomic: bigint;
};

export class FakeTreasury implements TreasuryRouter {
  readonly mode = "fake";
  /** Total USDC routed out, atomic units. */
  totalRouted = 0n;
  /** Individual transfers. */
  readonly transfers: { amountAtomic: bigint; txHash: string }[] = [];
  private seq = 0;
  private readonly minTransferAtomic: bigint;
  private readonly targetBufferAtomic: bigint;
  private readonly keepAtomic: bigint;

  constructor(options?: Partial<FakeTreasuryOptions>) {
    this.minTransferAtomic = options?.minTransferAtomic ?? 5_000_000n;
    this.targetBufferAtomic = options?.targetBufferAtomic ?? 10_000_000n;
    this.keepAtomic = options?.keepAtomic ?? 0n;
  }

  async rebalance(input: RebalanceInput): Promise<RebalanceResult> {
    const sendable = computeSendable(input.availableAtomic, {
      minTransferAtomic: this.minTransferAtomic,
      targetBufferAtomic: this.targetBufferAtomic,
      keepAtomic: this.keepAtomic,
    });
    if (sendable === null) {
      return { moved: false, reason: "below_threshold" };
    }
    const txHash = `fake-treasury-tx-${++this.seq}`;
    this.totalRouted += sendable;
    this.transfers.push({ amountAtomic: sendable, txHash });
    return { moved: true, amountAtomic: sendable, txHash };
  }
}

// ---------------------------------------------------------------------------
// Shared threshold math — used by FakeTreasury and CctpArqTreasury.
// ---------------------------------------------------------------------------

export type ThresholdConfig = {
  /** Don't bridge less than this (USDC atomic). */
  minTransferAtomic: bigint;
  /** The target USDC to keep on Solana (atomic). */
  targetBufferAtomic: bigint;
  /** Absolute minimum to keep (USDC atomic); never bridge below this. */
  keepAtomic: bigint;
};

/**
 * How much to send cross-chain right now, or null if there's nothing worth
 * sending. Pure function — no side effects.
 *
 * Logic: amount = available - max(targetBuffer, keep).
 * Only send when amount >= minTransfer.
 */
export function computeSendable(
  availableAtomic: bigint,
  config: ThresholdConfig,
): bigint | null {
  if (availableAtomic < 0n) throw new RangeError("computeSendable: negative available");
  if (config.minTransferAtomic <= 0n) throw new RangeError("computeSendable: minTransfer must be > 0");
  if (config.keepAtomic < 0n) throw new RangeError("computeSendable: keepAtomic must be >= 0");
  if (config.targetBufferAtomic < 0n) throw new RangeError("computeSendable: targetBufferAtomic must be >= 0");

  const retain = config.targetBufferAtomic > config.keepAtomic
    ? config.targetBufferAtomic
    : config.keepAtomic;

  if (availableAtomic <= retain) return null;
  const surplus = availableAtomic - retain;
  if (surplus < config.minTransferAtomic) return null;
  return surplus;
}
