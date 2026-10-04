import { SOLANA_USDC_DECIMALS, STELLAR_USDC_DECIMALS } from "./constants.ts";

const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

/**
 * Decimal string to atomic units. Extra fractional digits round half up.
 * Money stays a bigint — never a float — once it leaves this function.
 */
export function parseDecimalToAtomic(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError(`parseDecimalToAtomic: decimals out of range (${decimals})`);
  }
  if (!DECIMAL_RE.test(value)) {
    throw new RangeError(`parseDecimalToAtomic: not a decimal amount ("${value}")`);
  }
  const [whole, frac = ""] = value.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  let atomic = BigInt(whole ?? "0") * 10n ** BigInt(decimals) + BigInt(padded === "" ? "0" : padded);
  const extra = frac.slice(decimals);
  if (extra.length > 0 && extra[0]! >= "5") atomic += 1n;
  return atomic;
}

/** Human USDC (the number the app already shows) to 6-decimal atomic units. */
export function usdcToSolanaAtomic(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) {
    throw new RangeError(`usdcToSolanaAtomic: expected a non-negative finite number, got ${usdc}`);
  }
  const fixed = usdc.toFixed(SOLANA_USDC_DECIMALS);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return parseDecimalToAtomic(trimmed === "" ? "0" : trimmed, SOLANA_USDC_DECIMALS);
}

/** Same human amount in the original Stellar raw unit (1e-7). Used only to prove we do not send it on Solana. */
export function usdcToStellarRaw(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) {
    throw new RangeError(`usdcToStellarRaw: expected a non-negative finite number, got ${usdc}`);
  }
  const fixed = usdc.toFixed(STELLAR_USDC_DECIMALS);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return parseDecimalToAtomic(trimmed === "" ? "0" : trimmed, STELLAR_USDC_DECIMALS);
}

export function formatAtomic(atomic: bigint, decimals: number = SOLANA_USDC_DECIMALS): string {
  if (atomic < 0n) throw new RangeError("formatAtomic: negative");
  const base = 10n ** BigInt(decimals);
  const whole = atomic / base;
  const frac = (atomic % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
}

/**
 * Off-chain cumulative usage, in 6-decimal atomic units, capped by the deposit.
 * `meteredBytes` uses decimal megabytes (1 MB = 1_000_000 bytes), matching the
 * mission meter. One close spends this total; nothing here is a per-MB debit.
 */
export function usageAtomic(params: {
  meteredBytes: bigint;
  pricePerMbUsdc: number;
  depositAtomic: bigint;
}): bigint {
  if (params.meteredBytes < 0n || params.depositAtomic < 0n) {
    throw new RangeError("usageAtomic: negative input");
  }
  const priceAtomic = usdcToSolanaAtomic(params.pricePerMbUsdc);
  const used = (params.meteredBytes * priceAtomic) / 1_000_000n;
  return used > params.depositAtomic ? params.depositAtomic : used;
}
