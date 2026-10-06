// Treasury sweep: threshold, float, disabled, and a second pass that does not
// send again. The chain double is in memory; the amount rule is the same one
// SolanaEscrowChain transfers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeEscrowChain } from "../solana/FakeEscrowChain.ts";
import { runFundFlowOnce } from "../jobs/fund-flow.ts";
import {
  sweepAmount,
  treasuryConfigFromEnv,
  TREASURY_SWEEP_MIN_USDC_DEFAULT,
} from "./sweep.ts";

const TREASURY = "GmqSpjbis6DZV4easxKdPpRZmhx7RBoDJDsFB2psnYDx";
const ONE = 1_000_000n;

const idle = {
  async openMissionIds() {
    return [];
  },
  async advance(missionId: string) {
    return { missionId, fundedCents: 0 };
  },
};

test("sweepAmount keeps the float and refuses a surplus under the minimum", () => {
  assert.equal(sweepAmount(500_000n, { minAtomic: ONE, keepAtomic: 0n }), null);
  assert.equal(sweepAmount(ONE, { minAtomic: ONE, keepAtomic: 0n }), ONE);
  assert.equal(sweepAmount(1_500_000n, { minAtomic: ONE, keepAtomic: ONE }), null);
  assert.equal(sweepAmount(2_000_000n, { minAtomic: ONE, keepAtomic: ONE }), ONE);
  assert.equal(sweepAmount(3_500_000n, { minAtomic: ONE, keepAtomic: ONE }), 2_500_000n);
  assert.equal(sweepAmount(ONE, { minAtomic: ONE, keepAtomic: ONE }), null);
  assert.throws(() => sweepAmount(-1n, { minAtomic: ONE, keepAtomic: 0n }), RangeError);
});

test("treasury config is off without an address, and defaults the minimum to 1 USDC", () => {
  assert.equal(TREASURY_SWEEP_MIN_USDC_DEFAULT, 1);
  assert.deepEqual(treasuryConfigFromEnv({}), { enabled: false, reason: "unset" });
  assert.deepEqual(treasuryConfigFromEnv({ BRIDGE_LIQUIDATION_ADDRESS: "  " }), { enabled: false, reason: "unset" });
  assert.deepEqual(treasuryConfigFromEnv({ BRIDGE_LIQUIDATION_ADDRESS: "not-an-address" }), {
    enabled: false,
    reason: "invalid_address",
  });

  const configured = treasuryConfigFromEnv({ BRIDGE_LIQUIDATION_ADDRESS: `  ${TREASURY}  ` });
  assert.deepEqual(configured, { enabled: true, address: TREASURY, minAtomic: ONE, keepAtomic: 0n });

  const custom = treasuryConfigFromEnv({
    BRIDGE_LIQUIDATION_ADDRESS: TREASURY,
    TREASURY_SWEEP_MIN_USDC: "2.5",
    TREASURY_FLOAT_USDC: "0.5",
  });
  assert.deepEqual(custom, { enabled: true, address: TREASURY, minAtomic: 2_500_000n, keepAtomic: 500_000n });

  const fallback = treasuryConfigFromEnv({
    BRIDGE_LIQUIDATION_ADDRESS: TREASURY,
    TREASURY_SWEEP_MIN_USDC: "0",
    TREASURY_FLOAT_USDC: "-1",
  });
  assert.deepEqual(fallback, { enabled: true, address: TREASURY, minAtomic: ONE, keepAtomic: 0n });
});

test("the sweep job leaves the float, skips a short surplus, and does not repeat", async () => {
  const chain = new FakeEscrowChain("prog");
  const lines: Record<string, unknown>[] = [];
  const treasury = { address: TREASURY, minAtomic: ONE, keepAtomic: ONE };
  const deps = { service: idle, chain, treasury, logger: (line: Record<string, unknown>) => lines.push(line) };

  chain.payeeBalance = 1_500_000n;
  assert.equal((await runFundFlowOnce(deps)).sweepTxHash, undefined);
  assert.equal(chain.payeeBalance, 1_500_000n);
  assert.equal(chain.swept.size, 0);

  chain.payeeBalance = 3_000_000n;
  const tick = await runFundFlowOnce(deps);
  assert.ok(tick.sweepTxHash);
  assert.equal(chain.payeeBalance, ONE);
  assert.equal(chain.swept.get(TREASURY), 2_000_000n);
  const logged = lines.find((line) => line.msg === "treasury sweep");
  assert.equal(logged?.txHash, tick.sweepTxHash);
  assert.equal(logged?.amountAtomic, "2000000");

  const again = await runFundFlowOnce(deps);
  assert.equal(again.sweepTxHash, undefined);
  assert.equal(chain.swept.get(TREASURY), 2_000_000n);
  assert.equal(chain.payeeBalance, ONE);

  chain.payeeBalance += 2_500_000n;
  const third = await runFundFlowOnce(deps);
  assert.notEqual(third.sweepTxHash, undefined);
  assert.notEqual(third.sweepTxHash, tick.sweepTxHash);
  assert.equal(chain.payeeBalance, ONE);
  assert.equal(chain.swept.get(TREASURY), 4_500_000n);
});

test("the sweep job is off when no liquidation address is configured", async () => {
  const chain = new FakeEscrowChain("prog");
  chain.payeeBalance = 10_000_000n;
  const tick = await runFundFlowOnce({ service: idle, chain });
  assert.equal(tick.sweepTxHash, undefined);
  assert.equal(tick.sweepError, undefined);
  assert.equal(chain.payeeBalance, 10_000_000n);
  assert.equal(chain.swept.size, 0);
});
