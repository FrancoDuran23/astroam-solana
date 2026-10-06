import { createHash } from "node:crypto";
import { decodeBase58, encodeBase58, isSolanaAddress } from "./base58.ts";
import {
  DEFAULT_ESCROW_TIMEOUT_SECONDS,
  SOLANA_CLUSTER,
  SOLANA_EXPLORER,
  SOLANA_RPC_URL,
  SOLANA_USDC_DECIMALS,
  SOLANA_USDC_MINT,
  SPL_TOKEN_PROGRAM_ID,
  VOUCHER_PREFIX,
} from "./constants.ts";
import { formatAtomic, usageAtomic, usdcToSolanaAtomic } from "./amounts.ts";

export function escrowIdForMission(missionId: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(`astroam-escrow:${missionId}`).digest());
}

export function escrowIdBase58(missionId: string): string {
  return encodeBase58(escrowIdForMission(missionId));
}

/** Bytes the traveler signs. Must match `close_voucher_message` in the program. */
export function closeVoucherMessage(programId: Uint8Array, escrowId: Uint8Array, amount: bigint): Uint8Array {
  if (programId.length !== 32 || escrowId.length !== 32) {
    throw new RangeError("closeVoucherMessage: program id and escrow id are 32 bytes");
  }
  if (amount < 0n || amount > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("closeVoucherMessage: amount out of u64 range");
  }
  const prefix = new TextEncoder().encode(VOUCHER_PREFIX);
  if (prefix.length !== 22) throw new Error("VOUCHER_PREFIX drifted from the program");
  const out = new Uint8Array(prefix.length + 32 + 32 + 8);
  out.set(prefix, 0);
  out.set(programId, prefix.length);
  out.set(escrowId, prefix.length + 32);
  const view = new DataView(out.buffer);
  view.setBigUint64(prefix.length + 64, amount, true);
  return out;
}

export type SolanaDepositPlan = {
  cluster: typeof SOLANA_CLUSTER;
  rpcUrl: string;
  explorer: string;
  usdcMint: typeof SOLANA_USDC_MINT;
  usdcDecimals: typeof SOLANA_USDC_DECIMALS;
  tokenProgram: typeof SPL_TOKEN_PROGRAM_ID;
  programId: string | null;
  payee: string | null;
  escrowId: string;
  amount: string;
  amountUsdc: string;
  timeoutSeconds: number;
  deployed: boolean;
  /**
   * The deposit may still register a session key (`SOLANA_ESCROW_SESSION_KEYS=true`).
   * That key does not authorize settlement: only the meter key does.
   */
  sessionKeys: boolean;
  /** Meter pubkey stored in the program config. Null until `SOLANA_METER_PUBKEY` is set. */
  meter: string | null;
};

export type SolanaClosePlan = SolanaDepositPlan & {
  cumulativeAmount: string;
  refundAtomic: string;
  usedUsdc: string;
  refundUsdc: string;
  traveler: string | null;
  /** Null until SOLANA_PROGRAM_ID is set. The wallet signs these exact bytes. */
  messageBase64: string | null;
};

function timeoutFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.SOLANA_TIMEOUT_SECONDS;
  if (!raw) return DEFAULT_ESCROW_TIMEOUT_SECONDS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_ESCROW_TIMEOUT_SECONDS;
  return parsed;
}

function readAddress(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !isSolanaAddress(trimmed)) return null;
  return trimmed;
}

export function buildDepositPlan(params: {
  missionId: string;
  budgetUsdc: number;
  env?: Record<string, string | undefined>;
}): SolanaDepositPlan {
  const env = params.env ?? process.env;
  const programId = readAddress(env.SOLANA_PROGRAM_ID);
  const payee = readAddress(env.SOLANA_PAYEE_ADDRESS);
  const meter = readAddress(env.SOLANA_METER_PUBKEY);
  const amount = usdcToSolanaAtomic(params.budgetUsdc);
  return {
    cluster: SOLANA_CLUSTER,
    rpcUrl: env.SOLANA_RPC_URL?.trim() || SOLANA_RPC_URL,
    explorer: SOLANA_EXPLORER,
    usdcMint: SOLANA_USDC_MINT,
    usdcDecimals: SOLANA_USDC_DECIMALS,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    programId,
    payee,
    escrowId: escrowIdBase58(params.missionId),
    amount: amount.toString(),
    amountUsdc: formatAtomic(amount),
    timeoutSeconds: timeoutFromEnv(env),
    deployed: programId !== null && payee !== null,
    sessionKeys: programId !== null && payee !== null && env.SOLANA_ESCROW_SESSION_KEYS?.trim() === "true",
    meter,
  };
}

export function buildClosePlan(params: {
  missionId: string;
  budgetUsdc: number;
  meteredBytes: bigint;
  pricePerMbUsdc: number;
  traveler?: string | null;
  env?: Record<string, string | undefined>;
}): SolanaClosePlan {
  const deposit = buildDepositPlan(params);
  const depositAtomic = BigInt(deposit.amount);
  const used = usageAtomic({
    meteredBytes: params.meteredBytes,
    pricePerMbUsdc: params.pricePerMbUsdc,
    depositAtomic,
  });
  const refund = depositAtomic - used;
  let messageBase64: string | null = null;
  if (deposit.programId) {
    const message = closeVoucherMessage(decodeBase58(deposit.programId), decodeBase58(deposit.escrowId), used);
    messageBase64 = Buffer.from(message).toString("base64");
  }
  const traveler = params.traveler && isSolanaAddress(params.traveler) ? params.traveler : null;
  return {
    ...deposit,
    cumulativeAmount: used.toString(),
    refundAtomic: refund.toString(),
    usedUsdc: formatAtomic(used),
    refundUsdc: formatAtomic(refund),
    traveler,
    messageBase64,
  };
}

export function buildTopUpPlan(params: {
  missionId: string;
  amountUsdc: number;
  env?: Record<string, string | undefined>;
}): SolanaDepositPlan {
  return buildDepositPlan({
    missionId: params.missionId,
    budgetUsdc: params.amountUsdc,
    env: params.env,
  });
}
