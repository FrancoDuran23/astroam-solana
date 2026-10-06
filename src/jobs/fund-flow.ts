// Fund-flow job: runs the automatic fund flow for every open trip, so
// nobody has to operate it by hand. Each tick it asks the product service to
// advance each trip (read usage, fund the next eSIM tranche, claim, close
// when due) and then sweeps collected USDC to the treasury address.
//
// One tick never overlaps the next: a slow pass delays the following one.

import type { AdvanceResult } from "../product/services/MissionProductService.ts";
import type { EscrowChain } from "../solana/EscrowChain.ts";
import type { EnabledTreasury } from "../treasury/sweep.ts";

export const FUND_FLOW_INTERVAL_MS_DEFAULT = 60_000;

export type FundFlowJobDeps = {
  service: {
    openMissionIds(): Promise<string[]>;
    advance(missionId: string, now?: Date): Promise<AdvanceResult>;
  };
  chain: EscrowChain;
  /** Where collected USDC goes (`BRIDGE_LIQUIDATION_ADDRESS`). Without it nothing is swept. */
  treasury?: EnabledTreasury;
  logger?: (line: Record<string, unknown>) => void;
  now?: () => Date;
};

export type FundFlowTick = {
  advanced: AdvanceResult[];
  sweepTxHash?: string;
  sweepError?: string;
};

/** One pass over every open trip, then the treasury sweep. Never throws. */
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

  if (deps.treasury) {
    try {
      const swept = await deps.chain.sweep({
        to: deps.treasury.address,
        minAtomic: deps.treasury.minAtomic,
        keepAtomic: deps.treasury.keepAtomic,
      });
      if (swept) {
        tick.sweepTxHash = swept.txHash;
        logger({
          level: "info",
          msg: "treasury sweep",
          txHash: swept.txHash,
          amountAtomic: swept.amountAtomic.toString(),
          keepAtomic: deps.treasury.keepAtomic.toString(),
          to: deps.treasury.address,
        });
      }
    } catch (error) {
      tick.sweepError = error instanceof Error ? error.message : String(error);
      logger({ level: "error", msg: "treasury sweep failed", detail: tick.sweepError });
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
