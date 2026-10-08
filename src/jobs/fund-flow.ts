// Fund-flow job: runs the automatic fund flow for every open trip, so
// nobody has to operate it by hand. Each tick it asks the product service to
// advance each trip (read usage, fund the next eSIM tranche, claim, close
// when due) and then asks the treasury router to rebalance.
//
// fund-flow does NOT know about CCTP, ARQ, Polygon, Bridge.xyz, or any
// cross-chain detail. It calls `treasury.rebalance()` and that's it.
//
// One tick never overlaps the next: a slow pass delays the following one.

import type { AdvanceResult } from "../product/services/MissionProductService.ts";
import type { TreasuryRouter, RebalanceResult } from "../treasury/TreasuryRouter.ts";

export const FUND_FLOW_INTERVAL_MS_DEFAULT = 60_000;

export type FundFlowJobDeps = {
  service: {
    openMissionIds(): Promise<string[]>;
    advance(missionId: string, now?: Date): Promise<AdvanceResult>;
  };
  /** The treasury router decides what to do with collected USDC. */
  treasury: TreasuryRouter;
  /** Provides the current payee USDC balance for the treasury. */
  getPayeeBalanceAtomic?: () => Promise<bigint>;
  logger?: (line: Record<string, unknown>) => void;
  now?: () => Date;
};

export type FundFlowTick = {
  advanced: AdvanceResult[];
  treasuryResult?: RebalanceResult;
};

/** One pass over every open trip, then the treasury rebalance. Never throws. */
export async function runFundFlowOnce(deps: FundFlowJobDeps): Promise<FundFlowTick> {
  const logger = deps.logger ?? (() => {});
  const tick: FundFlowTick = { advanced: [] };

  let ids: string[] = [];
  try {
    ids = await deps.service.openMissionIds();
  } catch (error) {
    logger({ level: "error", msg: "fund flow could not list trips", detail: error instanceof Error ? error.message : String(error) });
  }
  for (const id of ids) {
    tick.advanced.push(await deps.service.advance(id, deps.now?.()));
  }

  // Treasury rebalance: the router decides if/how to move collected USDC.
  if (deps.getPayeeBalanceAtomic) {
    try {
      const availableAtomic = await deps.getPayeeBalanceAtomic();
      const result = await deps.treasury.rebalance({ availableAtomic });
      tick.treasuryResult = result;
      if (result.moved) {
        logger({
          level: "info",
          msg: "treasury rebalance",
          mode: deps.treasury.mode,
          amountAtomic: result.amountAtomic.toString(),
          txHash: result.txHash,
          detail: result.detail,
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      tick.treasuryResult = { moved: false, reason: `rebalance_error: ${detail}` };
      logger({ level: "error", msg: "treasury rebalance failed", detail });
    }
  }
  return tick;
}

/** Starts the job; returns a stop function. */
export function startFundFlowLoop(deps: FundFlowJobDeps, intervalMs: number = FUND_FLOW_INTERVAL_MS_DEFAULT): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    await runFundFlowOnce(deps);
    if (stopped) return;
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref?.();
  };
  void tick();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
