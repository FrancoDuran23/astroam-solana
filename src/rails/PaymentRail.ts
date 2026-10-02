// PaymentRail: everything chain-specific about paying for a mission sits
// behind this port. The product (src/product), the meter and the policy only
// talk to it, so the same app runs on any chain that implements it.
//
// Lifecycle of one mission's money:
//   1. createDepositIntent  — what the traveler's wallet has to sign: on an
//      EVM chain, `open()` on the channel contract with the USDC deposit.
//   2. confirmDeposit       — verifies that transaction and returns the
//      payment channel it opened (or topped up).
//   3. voucherPortFor       — signs cumulative vouchers against that channel
//      while the meter reads usage; nothing goes on-chain per MB.
//   4. closeChannel         — settles the highest voucher in one transaction
//      and refunds the rest of the deposit to the traveler.
//
// Amounts are in the internal raw unit (1 raw = 1e-7 USDC); each rail
// converts to its token's decimals.

import type { VoucherPort } from "../meter/voucher-port.ts";
import type { Network } from "../shared/network.ts";

export type DepositPurpose = "mission" | "topup";

export type DepositIntent = {
  intentId: string;
  /** What the traveler pays, in USDC. */
  amountUsdc: number;
  asset: "USDC";
  /** Address the deposit goes to (the channel contract, a program, …). */
  payTo: string;
  /** Wallet deep link for the deposit, when the chain has a standard one. */
  paymentUri?: string;
  /** QR image (data: URI) of `paymentUri`, for paying from another device. */
  qr?: string;
  /** true when no real chain is behind the intent (FakeRail). */
  isMock: boolean;
};

export type DepositConfirmation =
  | {
      valid: true;
      txHash: string;
      explorerUrl?: string;
      /** The channel this deposit opened or topped up. */
      channelId: string;
      /** Total deposited into the channel after this deposit. */
      depositRaw: bigint;
    }
  | { valid: false; reason: string };

export type CloseOutcome =
  | { kind: "closed"; txHash: string; explorerUrl?: string; settledRaw: bigint; refundedRaw: bigint }
  /** The close transaction landed but the settlement could not be verified. */
  | { kind: "closed_unverified"; txHash: string; explorerUrl?: string; settledRaw: bigint }
  /** No voucher was ever accepted for this channel: nothing to settle. */
  | { kind: "nothing_to_close"; detail: string }
  | { kind: "blocked"; reason: string; detail: string }
  | {
      kind: "failed";
      reason: "channel_not_found" | "refund_not_received" | "close_error" | "upstream_unavailable" | "channel_mismatch";
      detail: string;
    };

export interface PaymentRail {
  /** `<chain>:<name>`, carried in every voucher request (M1). */
  readonly network: Network;
  /** Human name for the UI and logs, e.g. "Monad testnet". */
  readonly displayName: string;
  /** false when payments are simulated (FakeRail). */
  readonly isLive: boolean;

  createDepositIntent(input: {
    missionId: string;
    amountUsdc: number;
    purpose: DepositPurpose;
    /** Required for a top-up: the channel to add funds to. */
    channelId?: string;
  }): Promise<DepositIntent>;

  confirmDeposit(input: {
    missionId: string;
    intentId: string;
    txHash: string;
    purpose: DepositPurpose;
    channelId?: string;
  }): Promise<DepositConfirmation>;

  /** Total deposited into the channel: the policy's balance base. */
  getChannelDepositRaw(channelId: string): Promise<bigint>;

  /** Signs cumulative vouchers for this channel (the meter's POST /vouchers). */
  voucherPortFor(channelId: string): VoucherPort;

  closeChannel(channelId: string): Promise<CloseOutcome>;

  /** Block-explorer link for a transaction, when there is a real chain. */
  explorerTxUrl(txHash: string): string | undefined;
}
