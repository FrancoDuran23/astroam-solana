import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideRebalance,
  isTransferInTransit,
  calculateInTransitLiquidityAtomic,
  liquidityConfigFromEnv,
  type LiquidityConfig,
} from "./LiquidityPolicy.ts";
import {
  ManualArqBalanceProvider,
  MockArqBalanceProvider,
} from "./OperationalBalanceProvider.ts";
import { TreasuryRebalancer } from "./TreasuryRebalancer.ts";
import {
  MemoryTreasuryTransferStore,
  confirmArqAccreditation,
  type TreasuryTransferRecord,
} from "./TreasuryTransferStore.ts";
import { FakeTreasury } from "./TreasuryRouter.ts";
import { MemoryResellerFundingGate } from "../services/ResellerFundingGate.ts";
import { bootTreasury } from "./config.ts";

const defaultConfig: LiquidityConfig = {
  minTransferAtomic: 5_000_000n,       // 5 USDC
  keepTreasuryAtomic: 5_000_000n,      // 5 USDC
  targetArqAtomic: 20_000_000n,        // 20 USDC
  maxArqAtomic: 100_000_000n,          // 100 USDC
  citrusTargetUsdAtomic: 10_000_000n,  // 10 USD
  citrusMinUsdAtomic: 2_000_000n,      // 2 USD
  maxTransferAtomic: 50_000_000n,      // 50 USDC max guard
};

test("LIQUIDITY POLICY 1: Enough operational buffer => no transfer (buffer_sufficient)", () => {
  const decision = decideRebalance({
    treasuryBalanceAtomic: 100_000_000n,
    operationalBalanceAtomic: 25_000_000n, // 25 > 20 target
    inTransitAtomic: 0n,
    minimumTransferAtomic: defaultConfig.minTransferAtomic,
    targetOperationalAtomic: defaultConfig.targetArqAtomic,
    keepTreasuryAtomic: defaultConfig.keepTreasuryAtomic,
  });

  assert.equal(decision.shouldTransfer, false);
  assert.equal(decision.amountAtomic, 0n);
  assert.equal(decision.reason, "buffer_sufficient");
});

test("LIQUIDITY POLICY 2: Low operational buffer => transfer (rebalance_required)", () => {
  const decision = decideRebalance({
    treasuryBalanceAtomic: 100_000_000n, // 100 available
    operationalBalanceAtomic: 0n,         // 0 operational
    inTransitAtomic: 0n,
    minimumTransferAtomic: defaultConfig.minTransferAtomic,
    targetOperationalAtomic: defaultConfig.targetArqAtomic, // 20 target
    keepTreasuryAtomic: defaultConfig.keepTreasuryAtomic,     // 5 keep
  });

  assert.equal(decision.shouldTransfer, true);
  assert.equal(decision.amountAtomic, 20_000_000n); // 20 USDC needed
  assert.equal(decision.reason, "rebalance_required");
});

test("LIQUIDITY POLICY 3: Below minimum transfer => no transfer (below_minimum_transfer)", () => {
  const decision = decideRebalance({
    treasuryBalanceAtomic: 8_000_000n, // 8 available - 5 keep = 3 sendable (< 5 min)
    operationalBalanceAtomic: 0n,
    inTransitAtomic: 0n,
    minimumTransferAtomic: defaultConfig.minTransferAtomic, // 5 min
    targetOperationalAtomic: defaultConfig.targetArqAtomic,
    keepTreasuryAtomic: defaultConfig.keepTreasuryAtomic,   // 5 keep
  });

  assert.equal(decision.shouldTransfer, false);
  assert.equal(decision.amountAtomic, 0n);
  assert.equal(decision.reason, "below_minimum_transfer");
});

test("LIQUIDITY POLICY 4: Keep reserve never violated (treasury_reserve_protected)", () => {
  const decision = decideRebalance({
    treasuryBalanceAtomic: 5_000_000n, // Exactly keep reserve (5 USDC)
    operationalBalanceAtomic: 0n,
    inTransitAtomic: 0n,
    minimumTransferAtomic: defaultConfig.minTransferAtomic,
    targetOperationalAtomic: defaultConfig.targetArqAtomic,
    keepTreasuryAtomic: defaultConfig.keepTreasuryAtomic,
  });

  assert.equal(decision.shouldTransfer, false);
  assert.equal(decision.amountAtomic, 0n);
  assert.equal(decision.reason, "treasury_reserve_protected");
});

test("LIQUIDITY POLICY 5: Max transfer cap never exceeded (exceeds_max_transfer_guard)", () => {
  const decision = decideRebalance({
    treasuryBalanceAtomic: 500_000_000n,
    operationalBalanceAtomic: 0n,
    inTransitAtomic: 0n,
    minimumTransferAtomic: defaultConfig.minTransferAtomic,
    targetOperationalAtomic: 100_000_000n, // 100 USDC needed
    keepTreasuryAtomic: defaultConfig.keepTreasuryAtomic,
    maxTransferAtomic: 30_000_000n, // 30 USDC max cap guard
  });

  assert.equal(decision.shouldTransfer, false);
  assert.equal(decision.amountAtomic, 0n);
  assert.equal(decision.reason, "exceeds_max_transfer_guard");
});

test("LIQUIDITY POLICY 6: In-transit amount prevents duplicate funding", () => {
  const decision = decideRebalance({
    treasuryBalanceAtomic: 100_000_000n,
    operationalBalanceAtomic: 5_000_000n,  // 5 confirmed
    inTransitAtomic: 15_000_000n,          // 15 in-transit
    minimumTransferAtomic: defaultConfig.minTransferAtomic,
    targetOperationalAtomic: defaultConfig.targetArqAtomic, // 20 target
    keepTreasuryAtomic: defaultConfig.keepTreasuryAtomic,
  });

  // 5 + 15 = 20 >= 20 => buffer_sufficient!
  assert.equal(decision.shouldTransfer, false);
  assert.equal(decision.amountAtomic, 0n);
  assert.equal(decision.reason, "buffer_sufficient");
});

test("LIQUIDITY POLICY 7: Completed transfer removed from in-transit calculation", () => {
  const record1: TreasuryTransferRecord = {
    v: 1,
    transferId: "trf_1",
    amountAtomic: "20000000",
    sourceChain: "solana",
    destinationChain: "polygon",
    destinationAddress: "0x1111111111111111111111111111111111111111",
    state: "source_submitted", // in-transit
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const record2: TreasuryTransferRecord = {
    v: 1,
    transferId: "trf_2",
    amountAtomic: "10000000",
    sourceChain: "solana",
    destinationChain: "polygon",
    destinationAddress: "0x1111111111111111111111111111111111111111",
    state: "completed", // completed (NOT in-transit)
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  assert.equal(isTransferInTransit(record1), true);
  assert.equal(isTransferInTransit(record2), false);

  const inTransit = calculateInTransitLiquidityAtomic([record1, record2]);
  assert.equal(inTransit, 20_000_000n); // only record1 counted
});

test("LIQUIDITY POLICY 8: ARQ manual balance provider accepted", async () => {
  const provider = new ManualArqBalanceProvider(15_000_000n);
  const bal = await provider.getBalanceAtomic();
  assert.equal(bal, 15_000_000n);

  provider.setBalanceAtomic(25_000_000n);
  const updated = await provider.getBalanceAtomic();
  assert.equal(updated, 25_000_000n);
});

test("LIQUIDITY POLICY 9: Unknown ARQ balance fails safely (unknown_operational_balance)", async () => {
  const store = new MemoryTreasuryTransferStore();
  const router = new FakeTreasury();
  const arqProvider = new ManualArqBalanceProvider(null); // null = unknown

  const rebalancer = new TreasuryRebalancer({
    treasuryRouter: router,
    store,
    arqBalanceProvider: arqProvider,
    config: defaultConfig,
  });

  const res = await rebalancer.runFundFlowOnce(100_000_000n);
  assert.equal(res.moved, false);
  assert.equal(res.reason, "unknown_operational_balance");
});

test("LIQUIDITY POLICY 10: Citrus failure does not break treasury recovery", async () => {
  const gate = new MemoryResellerFundingGate();
  gate.halt({ reason: "balance.auto_refill_failed" });
  assert.equal(gate.isHalted(), true);

  const store = new MemoryTreasuryTransferStore();
  const router = new FakeTreasury({
    minTransferAtomic: defaultConfig.minTransferAtomic,
    targetBufferAtomic: 0n,
    keepAtomic: defaultConfig.keepTreasuryAtomic,
  });
  const arqProvider = new MockArqBalanceProvider(0n);

  const rebalancer = new TreasuryRebalancer({
    treasuryRouter: router,
    store,
    arqBalanceProvider: arqProvider,
    config: defaultConfig,
  });

  // Rebalancing runs and moves funds safely even when Citrus funding gate is halted
  const res = await rebalancer.runFundFlowOnce(100_000_000n);
  assert.equal(res.moved, true);
  assert.equal(res.amountAtomic, 20_000_000n);
});

test("LIQUIDITY POLICY 11: Two fund-flow ticks produce exactly one transfer (Idempotency)", async () => {
  const store = new MemoryTreasuryTransferStore();
  const router = new FakeTreasury({
    minTransferAtomic: defaultConfig.minTransferAtomic,
    targetBufferAtomic: 0n,
    keepAtomic: defaultConfig.keepTreasuryAtomic,
  });
  const arqProvider = new MockArqBalanceProvider(0n);

  const rebalancer = new TreasuryRebalancer({
    treasuryRouter: router,
    store,
    arqBalanceProvider: arqProvider,
    config: defaultConfig,
  });

  // Tick 1: Initiates rebalance and stores transfer in journal
  const tick1 = await rebalancer.runFundFlowOnce(100_000_000n);
  assert.equal(tick1.moved, true);

  // Add an active in-transit transfer record to store simulating Tick 1's effect
  await store.save({
    v: 1,
    transferId: "trf_active_1",
    amountAtomic: "20000000",
    sourceChain: "solana",
    destinationChain: "polygon",
    destinationAddress: "0x1111111111111111111111111111111111111111",
    state: "source_submitted",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Tick 2: Sees active/in-transit transfer and does NOT launch a second transfer
  const tick2 = await rebalancer.runFundFlowOnce(100_000_000n);
  assert.equal(tick2.moved, false);
  assert.equal(tick2.reason, "transfer_already_in_progress");
});

test("LIQUIDITY POLICY 12: All financial arithmetic uses bigint exclusively", () => {
  const env: Record<string, string | undefined> = {
    TREASURY_MIN_TRANSFER_USDC: "10.5",
    TREASURY_KEEP_USDC: "5",
    TREASURY_TARGET_ARQ_USDC: "25",
    TREASURY_MAX_ARQ_USDC: "100",
    CITRUS_TARGET_BALANCE_USD: "15",
    CITRUS_MIN_BALANCE_USD: "3",
    TREASURY_MAX_TRANSFER_USDC: "50",
  };

  const parsed = liquidityConfigFromEnv(env);
  assert.equal(typeof parsed.minTransferAtomic, "bigint");
  assert.equal(typeof parsed.keepTreasuryAtomic, "bigint");
  assert.equal(typeof parsed.targetArqAtomic, "bigint");
  assert.equal(typeof parsed.maxArqAtomic, "bigint");
  assert.equal(typeof parsed.citrusTargetUsdAtomic, "bigint");
  assert.equal(typeof parsed.citrusMinUsdAtomic, "bigint");
  assert.equal(typeof parsed.maxTransferAtomic, "bigint");

  assert.equal(parsed.minTransferAtomic, 10_500_000n);
  assert.equal(parsed.keepTreasuryAtomic, 5_000_000n);
  assert.equal(parsed.targetArqAtomic, 25_000_000n);
  assert.equal(parsed.maxArqAtomic, 100_000_000n);
  assert.equal(parsed.citrusTargetUsdAtomic, 15_000_000n);
  assert.equal(parsed.citrusMinUsdAtomic, 3_000_000n);
  assert.equal(parsed.maxTransferAtomic, 50_000_000n);
});

test("ARQ RECONCILIATION 1: confirmArqAccreditation removes amount from inTransit & updates state safely", async () => {
  const store = new MemoryTreasuryTransferStore();
  await store.save({
    v: 1,
    transferId: "trf_arq_rec_1",
    amountAtomic: "20000000",
    sourceChain: "solana:mainnet-beta",
    destinationChain: "polygon:mainnet",
    destinationAddress: "0x1111111111111111111111111111111111111111",
    state: "arq_accreditation_pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const beforeRecords = store.listAll();
  assert.equal(calculateInTransitLiquidityAtomic(beforeRecords), 20_000_000n);

  // Reconcile / confirm accreditation
  const confirmedRecord = await confirmArqAccreditation(store, "trf_arq_rec_1", 20_000_000n);
  assert.equal(confirmedRecord.state, "completed");

  const afterRecords = store.listAll();
  assert.equal(calculateInTransitLiquidityAtomic(afterRecords), 0n);
});

test("ARQ RECONCILIATION 2: Same transfer cannot be confirmed twice & wrong transferId rejected", async () => {
  const store = new MemoryTreasuryTransferStore();
  await store.save({
    v: 1,
    transferId: "trf_arq_rec_2",
    amountAtomic: "10000000",
    sourceChain: "solana:mainnet-beta",
    destinationChain: "polygon:mainnet",
    destinationAddress: "0x1111111111111111111111111111111111111111",
    state: "arq_accreditation_pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await confirmArqAccreditation(store, "trf_arq_rec_2");

  // Attempting second confirmation throws error
  await assert.rejects(
    async () => confirmArqAccreditation(store, "trf_arq_rec_2"),
    /expected pending accreditation/,
  );

  // Non-existent transferId throws error
  await assert.rejects(
    async () => confirmArqAccreditation(store, "non_existent_id"),
    /not found in journal/,
  );
});

test("ARQ RECONCILIATION 3: Amount mismatch fails safely", async () => {
  const store = new MemoryTreasuryTransferStore();
  await store.save({
    v: 1,
    transferId: "trf_arq_rec_3",
    amountAtomic: "15000000",
    sourceChain: "solana:mainnet-beta",
    destinationChain: "polygon:mainnet",
    destinationAddress: "0x1111111111111111111111111111111111111111",
    state: "arq_accreditation_pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await assert.rejects(
    async () => confirmArqAccreditation(store, "trf_arq_rec_3", 20_000_000n),
    /amount mismatch/,
  );
});

test("PRODUCTION CONFIG: TREASURY_MODE=cctp-arq requires explicit non-empty SOLANA_RPC_URL and POLYGON_RPC_URL", () => {
  const envMissingSolanaRpc: Record<string, string | undefined> = {
    TREASURY_MODE: "cctp-arq",
    TREASURY_REAL_ENABLED: "true",
    SOLANA_CLUSTER: "mainnet-beta",
    POLYGON_NETWORK: "mainnet",
    ARQ_POLYGON_USDC_ADDRESS: "0x1111111111111111111111111111111111111111",
    POLYGON_RPC_URL: "https://polygon-mainnet.g.alchemy.com/v2/test",
  };

  assert.throws(
    () => bootTreasury(envMissingSolanaRpc),
    /requires an explicit non-empty mainnet SOLANA_RPC_URL/,
  );

  const envMissingPolygonRpc: Record<string, string | undefined> = {
    TREASURY_MODE: "cctp-arq",
    TREASURY_REAL_ENABLED: "true",
    SOLANA_CLUSTER: "mainnet-beta",
    POLYGON_NETWORK: "mainnet",
    ARQ_POLYGON_USDC_ADDRESS: "0x1111111111111111111111111111111111111111",
    SOLANA_RPC_URL: "https://mainnet.helius-rpc.com",
  };

  assert.throws(
    () => bootTreasury(envMissingPolygonRpc),
    /requires an explicit non-empty mainnet POLYGON_RPC_URL/,
  );
});
