// TreasuryRebalancer: Orchestrates the ASTROAM liquidity policy and rebalancing triggers.
//
// Features:
// - Implements TreasuryRouter interface to enforce sole production entry path.
// - Integrates OperationalBalanceProvider (ARQ / Citrus balances)
// - Computes in-transit liquidity and active transfers from TreasuryTransferStore
// - Executes pure decision logic via decideRebalance
// - Guarantees idempotency (two consecutive ticks will not launch duplicate transfers)
// - Safe handling for unknown operational balances (fails closed without moving funds)
// - Manual ARQ Reconciliation API to eliminate double-counting window before updating manual balance

import type { TreasuryRouter, RebalanceInput, RebalanceResult } from "./TreasuryRouter.ts";
import type { TreasuryTransferStore, TreasuryTransferRecord } from "./TreasuryTransferStore.ts";
import { confirmArqAccreditation as storeConfirmArqAccreditation } from "./TreasuryTransferStore.ts";
import type { OperationalBalanceProvider } from "./OperationalBalanceProvider.ts";
import type { LiquidityConfig } from "./LiquidityPolicy.ts";
import {
  decideRebalance,
  calculateInTransitLiquidityAtomic,
  isTransferInTransit,
} from "./LiquidityPolicy.ts";

export type TreasuryRebalancerOptions = {
  treasuryRouter: TreasuryRouter;
  store: TreasuryTransferStore;
  arqBalanceProvider: OperationalBalanceProvider;
  citrusBalanceProvider?: OperationalBalanceProvider;
  config: LiquidityConfig;
  logger?: (line: Record<string, unknown>) => void;
};

export class TreasuryRebalancer implements TreasuryRouter {
  readonly mode: string;
  private readonly router: TreasuryRouter;
  private readonly store: TreasuryTransferStore;
  private readonly arqBalanceProvider: OperationalBalanceProvider;
  private readonly citrusBalanceProvider?: OperationalBalanceProvider;
  private readonly config: LiquidityConfig;
  private readonly logger: (line: Record<string, unknown>) => void;

  constructor(options: TreasuryRebalancerOptions) {
    this.router = options.treasuryRouter;
    this.store = options.store;
    this.arqBalanceProvider = options.arqBalanceProvider;
    this.citrusBalanceProvider = options.citrusBalanceProvider;
    this.config = options.config;
    this.logger = options.logger ?? (() => {});
    this.mode = options.treasuryRouter.mode;
  }

  /**
   * Implements TreasuryRouter interface.
   * Mandates that any rebalance call from fund-flow passes through LiquidityPolicy.
   */
  async rebalance(input: RebalanceInput): Promise<RebalanceResult> {
    return this.runFundFlowOnce(input.availableAtomic);
  }

  /**
   * Single rebalance tick execution.
   * Safe to call repeatedly on a timer or event loop.
   */
  async runFundFlowOnce(solanaTreasuryBalanceAtomic: bigint): Promise<RebalanceResult> {
    // 1. Fetch ARQ operational balance
    const arqBalanceAtomic = await this.arqBalanceProvider.getBalanceAtomic();
    if (arqBalanceAtomic === null) {
      this.logger({
        level: "warn",
        msg: "treasury_rebalance_aborted_unknown_arq_balance",
      });
      return {
        moved: false,
        reason: "unknown_operational_balance",
      };
    }

    // 2. Fetch all journal records to compute in-transit liquidity and active transfers
    const records = this.store.listAll();
    const inTransitAtomic = calculateInTransitLiquidityAtomic(records);
    const activeRecords = records.filter(isTransferInTransit);
    const hasActiveTransfer = activeRecords.length > 0;

    // 3. Make rebalance decision using pure LiquidityPolicy
    const decision = decideRebalance({
      treasuryBalanceAtomic: solanaTreasuryBalanceAtomic,
      operationalBalanceAtomic: arqBalanceAtomic,
      inTransitAtomic,
      minimumTransferAtomic: this.config.minTransferAtomic,
      targetOperationalAtomic: this.config.targetArqAtomic,
      keepTreasuryAtomic: this.config.keepTreasuryAtomic,
      maxTransferAtomic: this.config.maxTransferAtomic,
      hasActiveTransfer,
    });

    this.logger({
      level: "info",
      msg: "treasury_rebalance_decision",
      shouldTransfer: decision.shouldTransfer,
      amountAtomic: decision.amountAtomic.toString(),
      reason: decision.reason,
      solanaTreasuryBalanceAtomic: solanaTreasuryBalanceAtomic.toString(),
      arqBalanceAtomic: arqBalanceAtomic.toString(),
      inTransitAtomic: inTransitAtomic.toString(),
      hasActiveTransfer,
    });

    if (!decision.shouldTransfer) {
      return {
        moved: false,
        reason: decision.reason,
      };
    }

    // 4. Initiate rebalance via underlying TreasuryRouter with exact calculated amount + keep reserve
    const availableForRouter = decision.amountAtomic + this.config.keepTreasuryAtomic;
    return this.router.rebalance({ availableAtomic: availableForRouter });
  }

  /**
   * Manual ARQ Accreditation Reconciliation API.
   * Transitions transfer from arq_accreditation_pending -> arq_accreditation_confirmed -> completed.
   * Removals from inTransit MUST happen before updating manual ARQ confirmed balance.
   */
  async confirmArqAccreditation(
    transferId: string,
    expectedAmountAtomic?: bigint,
  ): Promise<TreasuryTransferRecord> {
    const record = await storeConfirmArqAccreditation(this.store, transferId, expectedAmountAtomic);
    this.logger({
      level: "info",
      msg: "arq_accreditation_confirmed_manually",
      transferId,
      amountAtomic: record.amountAtomic,
    });
    return record;
  }
}
