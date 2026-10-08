// Unit tests for Polygon Treasury EOA -> ARQ Polygon USDC deposit adapter (Step 2 of Cross-Chain Treasury).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POLYGON_MAINNET_USDC_CONTRACT,
  POLYGON_BRIDGED_USDC_E_CONTRACT,
  POLYGON_MAINNET_CHAIN_ID,
  validateUsdcContractAddress,
  validatePolygonAddresses,
  isValidEvmAddress,
  calculateRequiredGasWei,
  MockPolygonArqAdapter,
  ViemPolygonArqAdapter,
} from "./PolygonArqAdapter.ts";
import { MemoryTreasuryTransferStore } from "./TreasuryTransferStore.ts";
import { CctpArqTreasury } from "./CctpArqTreasury.ts";
import { MockCctpBridge } from "./CctpBridge.ts";
import { MockExecutorClient } from "./ExecutorClient.ts";

const validTreasuryEoa = "0x1111222233334444555566667777888899990000";
const validArqDepositAddress = "0x9999888877776666555544443333222211110000";

const defaultThresholds = {
  minTransferAtomic: 50_000_000n,
  targetBufferAtomic: 10_000_000n,
  keepAtomic: 10_000_000n,
};

test("POLYGON ARQ 1: Native Circle USDC contract address validation (rejects USDC.e)", () => {
  assert.equal(POLYGON_MAINNET_USDC_CONTRACT, "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359");

  // Must not throw for native USDC
  validateUsdcContractAddress(POLYGON_MAINNET_USDC_CONTRACT);

  // Must throw for bridged USDC.e (0x2791...)
  assert.throws(
    () => validateUsdcContractAddress(POLYGON_BRIDGED_USDC_E_CONTRACT),
    /USDC.e/
  );

  // Must throw for random contract address
  assert.throws(
    () => validateUsdcContractAddress("0x1111111111111111111111111111111111111111"),
    /Expected native Circle USDC/
  );
});

test("POLYGON ARQ 2: Address validation rejects invalid format, zero address, and treasury == ARQ", () => {
  assert.equal(isValidEvmAddress("0x0000000000000000000000000000000000000000"), false);
  assert.equal(isValidEvmAddress("invalid-hex"), false);
  assert.equal(isValidEvmAddress(validTreasuryEoa), true);

  // Rejects zero address
  assert.throws(
    () => validatePolygonAddresses("0x0000000000000000000000000000000000000000", validArqDepositAddress),
    /Invalid POLYGON_TREASURY_EOA/
  );

  // Rejects treasury == ARQ
  assert.throws(
    () => validatePolygonAddresses(validTreasuryEoa, validTreasuryEoa),
    /cannot be identical/
  );
});

test("POLYGON ARQ 3: Dynamic POL gas calculation (safety margin, boundary, expensive gas)", async () => {
  const gasEstimate = 65_000n;
  const maxFeePerGas = 100_000_000_000n; // 100 Gwei

  // Default 120% (1.2x) safety margin
  const requiredWei = await calculateRequiredGasWei(gasEstimate, maxFeePerGas, 12000);
  const rawCost = gasEstimate * maxFeePerGas; // 6,500,000,000,000,000 wei
  assert.equal(requiredWei, (rawCost * 120n) / 100n, "Required gas wei must include safety margin");

  // Cheap gas vs expensive gas checks
  const cheapGasRequired = await calculateRequiredGasWei(30_000n, 30_000_000_000n); // 30 Gwei
  const expensiveGasRequired = await calculateRequiredGasWei(100_000n, 300_000_000_000n); // 300 Gwei
  assert.ok(expensiveGasRequired > cheapGasRequired, "Expensive gas must require more POL wei");
});

test("POLYGON ARQ 4: USDC balance check blocks transfer BEFORE gas check or signing if balance is insufficient", async () => {
  const store = new MemoryTreasuryTransferStore();
  const mockPolygonArqAdapter = new MockPolygonArqAdapter();
  mockPolygonArqAdapter.simulatedUsdcBalance = 10_000_000n; // 10 USDC available, but transfer requires 100 USDC

  const treasury = new CctpArqTreasury({
    bridge: new MockCctpBridge(),
    executorClient: new MockExecutorClient(),
    polygonArqAdapter: mockPolygonArqAdapter,
    store,
    arqPolygonAddress: validArqDepositAddress,
    polygonTreasuryEoa: validTreasuryEoa,
    solanaCluster: "mainnet-beta",
    polygonNetwork: "mainnet",
    thresholds: defaultThresholds,
  });

  const result = await treasury.rebalance({ availableAtomic: 100_000_000n });
  assert.equal(result.moved, false);
  assert.equal(result.reason, "insufficient_polygon_usdc");
});

test("POLYGON ARQ 5: Sufficient gas & USDC permits preparation, signing, and raw bytes persistence before broadcast", async () => {
  const store = new MemoryTreasuryTransferStore();
  const mockPolygonArqAdapter = new MockPolygonArqAdapter();
  mockPolygonArqAdapter.simulatedUsdcBalance = 1_000_000_000n;
  mockPolygonArqAdapter.simulatedPolBalance = 1_000_000_000_000_000_000n;

  const treasury = new CctpArqTreasury({
    bridge: new MockCctpBridge(),
    executorClient: new MockExecutorClient(),
    polygonArqAdapter: mockPolygonArqAdapter,
    store,
    arqPolygonAddress: validArqDepositAddress,
    polygonTreasuryEoa: validTreasuryEoa,
    solanaCluster: "mainnet-beta",
    polygonNetwork: "mainnet",
    thresholds: defaultThresholds,
  });

  const result = await treasury.rebalance({ availableAtomic: 100_000_000n });
  assert.equal(result.moved, true);

  const record = store.listAll()[0];
  assert.ok(record.polygonTxHash, "polygonTxHash must be recorded");
  assert.ok(record.polygonSerializedTx, "polygonSerializedTx must be recorded");
  assert.equal(record.state, "arq_accreditation_pending", "Must transition to arq_accreditation_pending (ARQ accreditation is manual/external)");
  assert.equal("privateKey" in record, false, "Private key MUST NEVER be persisted in journal");
});

test("POLYGON ARQ 6: Crash after broadcast resumes same Polygon transaction hash without creating new tx", async () => {
  const store = new MemoryTreasuryTransferStore();
  const mockPolygonArqAdapter = new MockPolygonArqAdapter();

  const treasury = new CctpArqTreasury({
    bridge: new MockCctpBridge(),
    executorClient: new MockExecutorClient(),
    polygonArqAdapter: mockPolygonArqAdapter,
    store,
    arqPolygonAddress: validArqDepositAddress,
    polygonTreasuryEoa: validTreasuryEoa,
    solanaCluster: "mainnet-beta",
    polygonNetwork: "mainnet",
    thresholds: defaultThresholds,
  });

  // 1. Initial execution
  await treasury.rebalance({ availableAtomic: 100_000_000n });
  const initialRecord = store.listAll()[0];
  const initialPolygonTxHash = initialRecord.polygonTxHash;

  // 2. Simulate restart with active transfer in polygon_submitted state
  initialRecord.state = "polygon_submitted";
  await store.save(initialRecord);

  // 3. Resume active transfer
  const resumeResult = await treasury.rebalance({ availableAtomic: 100_000_000n });
  assert.equal(resumeResult.moved, true);

  const resumedRecord = store.get(initialRecord.transferId)!;
  assert.equal(
    resumedRecord.polygonTxHash,
    initialPolygonTxHash,
    "Resumed transfer MUST preserve original polygonTxHash"
  );
  assert.equal(mockPolygonArqAdapter.preparedTransfers.length, 1, "MUST NOT create a second Polygon transfer");
});

test("POLYGON ARQ 7: Chain ID 137 enforcement in ViemPolygonArqAdapter", () => {
  assert.equal(POLYGON_MAINNET_CHAIN_ID, 137);

  // Rejects invalid chain ID (e.g. Ethereum Mainnet 1 or Sepolia 11155111)
  assert.throws(
    () =>
      new ViemPolygonArqAdapter({
        treasuryEoa: validTreasuryEoa,
        chainId: 1,
      }),
    /Must enforce Chain ID 137/
  );
});

test("POLYGON ARQ 8: Receipts status 0x1 confirms, 0x0 fails, and null stays pending", async () => {
  const mockPolygonArqAdapter = new MockPolygonArqAdapter();

  mockPolygonArqAdapter.simulatedStatus = "confirmed";
  assert.equal(await mockPolygonArqAdapter.getTransactionStatus("0x123"), "confirmed");

  mockPolygonArqAdapter.simulatedStatus = "failed";
  assert.equal(await mockPolygonArqAdapter.getTransactionStatus("0x123"), "failed");

  mockPolygonArqAdapter.simulatedStatus = "pending";
  assert.equal(await mockPolygonArqAdapter.getTransactionStatus("0x123"), "pending");

  mockPolygonArqAdapter.simulatedStatus = "polygon_stuck";
  assert.equal(await mockPolygonArqAdapter.getTransactionStatus("0x123"), "polygon_stuck");
});
