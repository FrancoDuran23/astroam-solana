// YieldStrategy: where AstroAm's already-collected treasury USDC earns yield.
//
// The traveler's escrow deposit does NOT go into yield — that stays in the
// on-chain escrow program where the program guarantees the refund.
//
// Only USDC that has been claimed from the escrow and moved to the treasury
// is eligible for yield. This separation is critical:
// - Traveler funds: guaranteed by the escrow program, never at DeFi risk.
// - Treasury funds: already collected revenue, can earn yield.
//
// Research (from origin/docs/arquitectura-flujo-de-fondos):
// - Kamino Lend is deployed on Solana devnet.
// - USDC yield was 3.51% - 9% during 2026.
// - At current volumes, yield is small ($700/year on $20k).
// - Marginfi is NOT on devnet.
//
// Decision: NoopYieldStrategy for this iteration.
// The interface is ready for a KaminoYieldStrategy when volume justifies it.

export type DepositResult =
  | { deposited: true; amountAtomic: bigint; detail?: string }
  | { deposited: false; reason: string };

export type WithdrawResult =
  | { withdrawn: true; amountAtomic: bigint; detail?: string }
  | { withdrawn: false; reason: string };

export interface YieldStrategy {
  readonly name: string;
  /** Deposit treasury USDC into the yield protocol. */
  deposit(amountAtomic: bigint): Promise<DepositResult>;
  /** Withdraw USDC from the yield protocol back to treasury. */
  withdraw(amountAtomic: bigint): Promise<WithdrawResult>;
  /** Current balance earning yield, atomic units. */
  balance(): Promise<bigint>;
}

// ---------------------------------------------------------------------------
// NoopYieldStrategy — USDC stays idle in the treasury wallet.
// ---------------------------------------------------------------------------

export class NoopYieldStrategy implements YieldStrategy {
  readonly name = "noop";

  async deposit(_amountAtomic: bigint): Promise<DepositResult> {
    return { deposited: false, reason: "yield_strategy_noop" };
  }

  async withdraw(_amountAtomic: bigint): Promise<WithdrawResult> {
    return { withdrawn: false, reason: "yield_strategy_noop" };
  }

  async balance(): Promise<bigint> {
    return 0n;
  }
}

// ---------------------------------------------------------------------------
// FakeYieldStrategy — in-memory double for tests.
// ---------------------------------------------------------------------------

export class FakeYieldStrategy implements YieldStrategy {
  readonly name = "fake";
  private _balance = 0n;

  async deposit(amountAtomic: bigint): Promise<DepositResult> {
    if (amountAtomic <= 0n) return { deposited: false, reason: "invalid_amount" };
    this._balance += amountAtomic;
    return { deposited: true, amountAtomic };
  }

  async withdraw(amountAtomic: bigint): Promise<WithdrawResult> {
    if (amountAtomic <= 0n) return { withdrawn: false, reason: "invalid_amount" };
    if (amountAtomic > this._balance) return { withdrawn: false, reason: "insufficient_balance" };
    this._balance -= amountAtomic;
    return { withdrawn: true, amountAtomic };
  }

  async balance(): Promise<bigint> {
    return this._balance;
  }
}

// ---------------------------------------------------------------------------
// TODO: KaminoYieldStrategy
//
// When volume justifies it, implement using:
// - @kamino-finance/klend-sdk (verify latest version)
// - Deposit USDC into Kamino Lend reserve
// - Withdraw on demand for CCTP bridging
// - Monitor: utilization, available liquidity, protocol risk
//
// Prerequisites before implementation:
// 1. Verify Kamino SDK is still maintained and devnet works
// 2. Verify USDC reserve liquidity on Kamino
// 3. Assess smart contract risk (audit status, TVL)
// 4. Determine withdrawal latency (instant vs queued)
// 5. Consider: does yield exceed gas/tx costs at our volume?
// ---------------------------------------------------------------------------
