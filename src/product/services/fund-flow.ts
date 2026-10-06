// Rules of the automatic fund flow (docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md).
//
// AstroAm advances USD to the eSIM and collects USDC from the escrow. Two
// rules keep what it can lose at one tranche:
//
// - the eSIM wallet is never funded more than one tranche ahead of what the
//   meter vouchers already cover, and never past what the deposit pays for;
// - a voucher is collected with `claim` once it is worth a tranche, so a
//   traveler who closes with an old voucher cannot take that part back.
//
// Pure functions: no provider, no chain, no clock of their own.

import type { ProductMission } from "../types/mission.ts";

export type FundFlowConfig = {
  /** Size of one eSIM funding tranche, USD cents (`FUNDING_TRANCHE_CENTS`). */
  trancheCents: number;
  /** Smallest fund worth a provider call, USD cents (`FUNDING_MIN_CENTS`). */
  minFundCents: number;
  /** What the traveler pays over the provider's cost, basis points (`MARKUP_BPS`). */
  markupBps: number;
  /** USD per USDC, basis points (`USDC_USD_RATE_BPS`). */
  usdcUsdRateBps: number;
  /** Uncollected voucher amount that triggers a claim, USDC atomic units (`CLAIM_MIN_USDC`). */
  claimMinAtomic: bigint;
  /** How long before the escrow's refund timeout the backend closes, seconds (`ESCROW_CLOSE_MARGIN_SECONDS`). */
  closeMarginSeconds: number;
  /** Close a trip with no new usage for this long, seconds; 0 turns it off (`ESCROW_IDLE_CLOSE_SECONDS`). */
  idleCloseSeconds: number;
  /** How long after the trip's end date the backend closes, seconds (`ESCROW_TRIP_END_GRACE_SECONDS`). */
  tripEndGraceSeconds: number;
};

export const DEFAULT_FUND_FLOW: FundFlowConfig = {
  trancheCents: 250,
  minFundCents: 50,
  markupBps: 15_000,
  usdcUsdRateBps: 10_000,
  claimMinAtomic: 2_000_000n,
  closeMarginSeconds: 24 * 60 * 60,
  idleCloseSeconds: 0,
  tripEndGraceSeconds: 24 * 60 * 60,
};

function positiveInt(raw: string | undefined, fallback: number, allowZero = false): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || (value === 0 && !allowZero)) return fallback;
  return value;
}

export function fundFlowConfigFromEnv(env: Record<string, string | undefined>): FundFlowConfig {
  const d = DEFAULT_FUND_FLOW;
  const claimMinUsdc = Number(env.CLAIM_MIN_USDC);
  return {
    trancheCents: positiveInt(env.FUNDING_TRANCHE_CENTS, d.trancheCents),
    minFundCents: positiveInt(env.FUNDING_MIN_CENTS, d.minFundCents),
    markupBps: positiveInt(env.MARKUP_BPS, d.markupBps),
    usdcUsdRateBps: positiveInt(env.USDC_USD_RATE_BPS, d.usdcUsdRateBps),
    claimMinAtomic:
      Number.isFinite(claimMinUsdc) && claimMinUsdc > 0 ? BigInt(Math.round(claimMinUsdc * 1e6)) : d.claimMinAtomic,
    closeMarginSeconds: positiveInt(env.ESCROW_CLOSE_MARGIN_SECONDS, d.closeMarginSeconds),
    idleCloseSeconds: positiveInt(env.ESCROW_IDLE_CLOSE_SECONDS, d.idleCloseSeconds, true),
    tripEndGraceSeconds: positiveInt(env.ESCROW_TRIP_END_GRACE_SECONDS, d.tripEndGraceSeconds, true),
  };
}

/**
 * Provider cost, in whole USD cents, that `atomic` USDC from the traveler pays
 * for: the traveler pays cost × markup. 5 USDC at a 1.5× markup pays for
 * $3.33 of eSIM wallet, the same figure as `maxWalletCents`.
 */
export function costCentsPaidBy(atomic: bigint, config: FundFlowConfig): number {
  if (atomic < 0n) throw new RangeError("costCentsPaidBy: negative amount");
  return Number((atomic * BigInt(config.usdcUsdRateBps)) / (BigInt(config.markupBps) * 10_000n));
}

/**
 * Cents to fund into the eSIM wallet now. Funding goes one tranche past what
 * the voucher covers, capped by what the deposit pays for. 0 when the wallet
 * is already there, or the gap is too small to be worth a call.
 */
export function nextFundCents(
  input: { depositAtomic: bigint; voucherAtomic: bigint; fundedCents: number },
  config: FundFlowConfig,
): number {
  const cap = costCentsPaidBy(input.depositAtomic, config);
  const target = Math.min(costCentsPaidBy(input.voucherAtomic, config) + config.trancheCents, cap);
  const gap = target - input.fundedCents;
  return gap >= config.minFundCents ? gap : 0;
}

/** True when the voucher holds enough uncollected USDC to be worth a claim. */
export function claimIsDue(voucherAtomic: bigint, claimedAtomic: bigint, config: FundFlowConfig): boolean {
  return voucherAtomic > claimedAtomic && voucherAtomic - claimedAtomic >= config.claimMinAtomic;
}

export type AutoCloseReason = NonNullable<ProductMission["autoCloseReason"]>;

/**
 * Why the backend should close this trip by itself now, or null to leave it
 * open. `timeoutSeconds` is the escrow's refund timeout.
 */
export function autoCloseReason(
  mission: ProductMission,
  config: FundFlowConfig,
  now: Date,
  timeoutSeconds: number,
): AutoCloseReason | null {
  const nowMs = now.getTime();
  const deposit = BigInt(mission.depositAtomic ?? "0");
  const voucher = BigInt(mission.voucher?.cumulativeAtomic ?? "0");
  if (deposit > 0n && voucher >= deposit) return "deposit_spent";

  const tripEnd = Date.parse(`${mission.endDate}T00:00:00Z`);
  if (Number.isFinite(tripEnd) && nowMs >= tripEnd + (24 * 60 * 60 + config.tripEndGraceSeconds) * 1000) {
    return "trip_ended";
  }

  const activeAt = Date.parse(mission.escrowActiveAt ?? "");
  if (Number.isFinite(activeAt) && nowMs >= activeAt + (timeoutSeconds - config.closeMarginSeconds) * 1000) {
    return "timeout_near";
  }

  if (config.idleCloseSeconds > 0) {
    const lastUsage = Date.parse(mission.lastUsageAt ?? mission.escrowActiveAt ?? mission.createdAt);
    if (Number.isFinite(lastUsage) && nowMs >= lastUsage + config.idleCloseSeconds * 1000) return "idle";
  }
  return null;
}
