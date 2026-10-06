// FakeEscrowChain: an in-memory EscrowChain for tests and demos. It keeps the
// rules of programs/astroam-escrow that the backend relies on: a voucher must
// be signed by the meter key, a checkpoint records it without moving tokens,
// a claim only moves what was not paid yet, and a close cannot go below what
// was claimed or attested.

import { encodeBase58 } from "../shared/solana/base58.ts";
import { verifyVoucher, type EscrowState, type SignedVoucher } from "../shared/solana/escrow.ts";
import type { EscrowChain, SweepResult } from "./EscrowChain.ts";

export class FakeEscrowChain implements EscrowChain {
  readonly operator = encodeBase58(new Uint8Array(32).fill(0x77));
  /** USDC the payee holds, atomic units. */
  payeeBalance = 0n;
  /** USDC refunded to each traveler, atomic units. */
  readonly refunds = new Map<string, bigint>();
  /** USDC swept to each treasury address, atomic units. */
  readonly swept = new Map<string, bigint>();
  private readonly escrows = new Map<string, EscrowState>();
  private readonly programId: string;
  private readonly meter: string;
  private readonly now: () => Date;
  private seq = 0;

  constructor(programId: string, meter: string, now: () => Date = () => new Date()) {
    this.programId = programId;
    this.meter = meter;
    this.now = now;
  }

  /** Test seam: what the traveler's wallet does with the `deposit` instruction. */
  deposit(input: { escrowId: string; traveler: string; amount: bigint; sessionKey?: string }): void {
    if (this.escrows.has(input.escrowId)) throw new Error("escrow exists (custom error 3)");
    this.escrows.set(input.escrowId, {
      traveler: input.traveler,
      activeAt: this.seconds(),
      deposit: input.amount,
      settled: false,
      escrowId: input.escrowId,
      sessionKey: input.sessionKey ?? null,
      claimed: 0n,
      attested: 0n,
    });
  }

  private seconds(): number {
    return Math.floor(this.now().getTime() / 1000);
  }

  private txHash(): string {
    const bytes = new Uint8Array(64).fill(0x5a);
    bytes[63] = ++this.seq;
    return encodeBase58(bytes);
  }

  private open(escrowId: string, voucher: SignedVoucher): { state: EscrowState; amount: bigint } {
    const state = this.escrows.get(escrowId);
    if (!state) throw new Error("escrow missing (custom error 4)");
    if (state.settled) throw new Error("already settled (custom error 5)");
    const amount = BigInt(voucher.cumulativeAtomic);
    if (amount > state.deposit) throw new Error("amount exceeds the deposit (custom error 7)");
    if (voucher.signer !== this.meter || !verifyVoucher(this.programId, escrowId, voucher)) {
      throw new Error("bad voucher (custom error 8)");
    }
    return { state, amount };
  }

  async readEscrow(escrowId: string): Promise<EscrowState | null> {
    const state = this.escrows.get(escrowId);
    return state ? { ...state } : null;
  }

  async checkpoint(input: { escrowId: string; voucher: SignedVoucher }): Promise<string> {
    const { state, amount } = this.open(input.escrowId, input.voucher);
    if (amount < state.claimed) throw new Error("below what was claimed (custom error 14)");
    if (amount <= state.attested) throw new Error("nothing to claim (custom error 13)");
    state.attested = amount;
    return this.txHash();
  }

  async claim(input: { escrowId: string; voucher: SignedVoucher }): Promise<string> {
    const { state, amount } = this.open(input.escrowId, input.voucher);
    if (amount <= state.claimed) throw new Error("nothing to claim (custom error 13)");
    this.payeeBalance += amount - state.claimed;
    state.claimed = amount;
    if (amount > state.attested) state.attested = amount;
    state.activeAt = this.seconds();
    return this.txHash();
  }

  async close(input: { escrowId: string; voucher: SignedVoucher; traveler: string }): Promise<string> {
    const { state, amount } = this.open(input.escrowId, input.voucher);
    if (amount < state.claimed) throw new Error("below what was claimed (custom error 14)");
    if (amount < state.attested) throw new Error("below what was attested (custom error 15)");
    if (input.traveler !== state.traveler) throw new Error("bad account (custom error 12)");
    this.payeeBalance += amount - state.claimed;
    this.refunds.set(state.traveler, (this.refunds.get(state.traveler) ?? 0n) + state.deposit - amount);
    state.claimed = amount;
    state.attested = amount;
    state.settled = true;
    return this.txHash();
  }

  async sweep(input: { to: string; minAtomic: bigint }): Promise<SweepResult | null> {
    if (this.payeeBalance === 0n || this.payeeBalance < input.minAtomic) return null;
    const amountAtomic = this.payeeBalance;
    this.swept.set(input.to, (this.swept.get(input.to) ?? 0n) + amountAtomic);
    this.payeeBalance = 0n;
    return { txHash: this.txHash(), amountAtomic };
  }
}
