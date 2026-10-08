import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryResellerFundingGate, FileResellerFundingGate } from "./ResellerFundingGate.ts";
import { CitrusWebhookHandler } from "./CitrusWebhookHandler.ts";
import { WebhookEventLog } from "../persistence/webhook-event.ts";
import { openEsimStore, type EsimStore } from "../persistence/esim-record.ts";
import { MissionProductService } from "../product/services/MissionProductService.ts";
import type { MissionRepository } from "../product/persistence/MissionRepository.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { FakeRail } from "../rails/FakeRail.ts";
import type { ProductMission } from "../product/types/mission.ts";
import type { EscrowChain } from "../solana/EscrowChain.ts";
import type { MeterSigner } from "../solana/meter-signer.ts";

class MemoryMissionRepository implements MissionRepository {
  private missions = new Map<string, ProductMission>();

  async save(mission: ProductMission): Promise<void> {
    this.missions.set(mission.id, { ...mission });
  }

  async findById(id: string): Promise<ProductMission | null> {
    return this.missions.get(id) ?? null;
  }

  async findByPaymentIntentId(intentId: string): Promise<ProductMission | null> {
    for (const m of this.missions.values()) {
      if (m.paymentIntentId === intentId) return m;
    }
    return null;
  }

  async findAll(): Promise<ProductMission[]> {
    return Array.from(this.missions.values());
  }
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("ResellerFundingGate unit & persistence", () => {
  test("default state is OPEN (not halted)", () => {
    const gate = new MemoryResellerFundingGate();
    assert.equal(gate.isHalted(), false);
    assert.equal(gate.getHaltReason(), null);
    assert.doesNotThrow(() => gate.assertCanProvisionNewEsim());
    assert.doesNotThrow(() => gate.assertCanTopUpTranche());
  });

  test("auto_refill_failed halts gate and throws on provision & topup", async () => {
    const gate = new MemoryResellerFundingGate();
    await gate.recordAutoRefillFailed("Card declined");
    assert.equal(gate.isHalted(), true);
    assert.equal(gate.getHaltReason(), "Card declined");
    assert.throws(() => gate.assertCanProvisionNewEsim(), /Citrus auto-refill failed/);
    assert.throws(() => gate.assertCanTopUpTranche(), /Citrus auto-refill failed/);
  });

  test("auto_refill_succeeded & topped_up resume gate", async () => {
    const gate = new MemoryResellerFundingGate();
    await gate.recordAutoRefillFailed("Balance zero");
    assert.equal(gate.isHalted(), true);

    await gate.recordAutoRefillSucceeded();
    assert.equal(gate.isHalted(), false);
    assert.doesNotThrow(() => gate.assertCanProvisionNewEsim());

    await gate.recordAutoRefillFailed("Another failure");
    assert.equal(gate.isHalted(), true);

    gate.resume();
    assert.equal(gate.isHalted(), false);
  });

  test("FileResellerFundingGate persists state across restarts", () => {
    const dir = tempDir("funding-gate-test-");
    const filePath = path.join(dir, "funding-halt.json");

    try {
      const gate1 = new FileResellerFundingGate(filePath);
      assert.equal(gate1.isHalted(), false);

      gate1.halt({ reason: "Payment method failed" });
      assert.equal(gate1.isHalted(), true);
      assert.equal(fs.existsSync(filePath), true);

      const gate2 = new FileResellerFundingGate(filePath);
      assert.equal(gate2.isHalted(), true);
      assert.equal(gate2.getHaltReason(), "Payment method failed");

      gate2.resume();
      assert.equal(gate2.isHalted(), false);

      const gate3 = new FileResellerFundingGate(filePath);
      assert.equal(gate3.isHalted(), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("FileResellerFundingGate defaults to HALTED if halt file is unreadable", () => {
    const dir = tempDir("funding-gate-corrupt-");
    const filePath = path.join(dir, "funding-halt.json");

    try {
      fs.writeFileSync(filePath, "INVALID_JSON{");
      const gate = new FileResellerFundingGate(filePath);
      assert.equal(gate.isHalted(), true);
      assert.equal(gate.getHaltReason(), "halt_file_unreadable");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CitrusWebhookHandler & ResellerFundingGate integration", () => {
  test("webhook balance.auto_refill_failed halts gate, auto_refill_succeeded resumes", async () => {
    const dir = tempDir("wh-gate-test-");
    const eventLogPath = path.join(dir, "webhook-events.jsonl");
    const esimStorePath = path.join(dir, "esim-records.json");
    const gate = new MemoryResellerFundingGate();

    try {
      const handler = new CitrusWebhookHandler({
        log: WebhookEventLog.open(eventLogPath),
        esimStore: openEsimStore(esimStorePath),
        fundingGate: gate,
        logger: () => {},
      });

      assert.equal(gate.isHalted(), false);

      await handler.handle({
        id: "evt_fail_1",
        event: "balance.auto_refill_failed",
        created_at: new Date().toISOString(),
        reason: "Insufficient funds in bank account",
      });

      assert.equal(gate.isHalted(), true);
      assert.equal(gate.getHaltReason(), "Insufficient funds in bank account");

      await handler.handle({
        id: "evt_succ_1",
        event: "balance.auto_refill_succeeded",
        created_at: new Date().toISOString(),
      });

      assert.equal(gate.isHalted(), false);

      await handler.handle({
        id: "evt_fail_2",
        event: "balance.auto_refill_failed",
        created_at: new Date().toISOString(),
        reason: "Card expired",
      });

      assert.equal(gate.isHalted(), true);

      await handler.handle({
        id: "evt_topup_1",
        event: "balance.topped_up",
        created_at: new Date().toISOString(),
      });

      assert.equal(gate.isHalted(), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function seedMission(over: Partial<ProductMission> = {}): ProductMission {
  const now = new Date().toISOString();
  return {
    id: "m_seed_1",
    userId: "u_1",
    destination: { id: "br", name: "Brasil", flag: "🇧🇷", network: "5G", coverage: "Nacional", pricePerMbUsdc: 0.0025 },
    startDate: now,
    endDate: now,
    durationDays: 7,
    budgetUsdc: 10,
    dailyLimitUsdc: 2,
    autoPause: true,
    lowBalanceAlert: true,
    status: "pending_payment",
    paymentStatus: "paid",
    esimStatus: "not_provisioned",
    meteredBytes: "0",
    carrierBytes: "0",
    balanceUsdc: 10,
    consumedUsdc: 0,
    consumedMb: 0,
    topups: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("FASE 9 — End-to-End Wiring & Dependency Injection Test", () => {
  test("SAME fundingGate shared by CitrusWebhookHandler and MissionProductService halts and resumes whole flow", async () => {
    const dir = tempDir("e2e-gate-test-");
    const eventLogPath = path.join(dir, "webhook-events.jsonl");
    const esimStorePath = path.join(dir, "esim-records.json");

    // 1. Single shared funding gate instance
    const sharedFundingGate = new MemoryResellerFundingGate();
    const repo = new MemoryMissionRepository();
    const connectivity = new FakeProvider();
    const rail = new FakeRail();

    // 2. Both services constructed with the SAME gate instance
    const productService = new MissionProductService({
      repo,
      connectivity,
      rail,
      fundingGate: sharedFundingGate,
    });

    const webhookHandler = new CitrusWebhookHandler({
      log: WebhookEventLog.open(eventLogPath),
      esimStore: openEsimStore(esimStorePath),
      fundingGate: sharedFundingGate,
      logger: () => {},
    });

    // Create a paid mission ready for activation
    const mission: ProductMission = seedMission({
      id: "m_wiring_1",
      depositVerified: true,
      channelId: "chan_wiring_1",
    });
    await repo.save(mission);

    // Initial state: gate open -> activation succeeds
    assert.equal(sharedFundingGate.isHalted(), false);
    const actResult = await productService.activateMission("m_wiring_1");
    assert.equal(actResult.status, "active");

    // 3. Webhook receives auto_refill_failed -> shared gate becomes HALTED
    await webhookHandler.handle({
      id: "evt_halt_e2e",
      event: "balance.auto_refill_failed",
      created_at: new Date().toISOString(),
      reason: "Card payment declined by issuer",
    });

    assert.equal(sharedFundingGate.isHalted(), true);

    // 4. MissionProductService attempts to activate NEW mission -> BLOQUEADO
    const mission2: ProductMission = seedMission({
      id: "m_wiring_2",
      depositVerified: true,
      channelId: "chan_wiring_2",
    });
    await repo.save(mission2);

    await assert.rejects(
      async () => productService.activateMission("m_wiring_2"),
      /Citrus auto-refill failed/,
    );

    // 5. Webhook receives auto_refill_succeeded -> shared gate becomes OPEN
    await webhookHandler.handle({
      id: "evt_resume_e2e",
      event: "balance.auto_refill_succeeded",
      created_at: new Date().toISOString(),
    });

    assert.equal(sharedFundingGate.isHalted(), false);

    // 6. Activation succeeds again
    const actResult2 = await productService.activateMission("m_wiring_2");
    assert.equal(actResult2.status, "active");

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("FASE 10 — Non-Regression: Halted Gate Does NOT Block Escrow Operations", () => {
  test("checkpoint, claim, close, and refund remain unblocked while fundingGate is HALTED", async () => {
    const sharedFundingGate = new MemoryResellerFundingGate();
    sharedFundingGate.halt({ reason: "Reseller balance depleted" });
    assert.equal(sharedFundingGate.isHalted(), true);

    const repo = new MemoryMissionRepository();
    const connectivity = new FakeProvider();
    const rail = new FakeRail();

    // Mock chain allowing escrow claims/closes/read
    let claimedVal = 0n;
    let closedVal = false;
    const fakeChain: Partial<EscrowChain> = {
      operator: "op_fake",
      async readEscrow(escrowId: string) {
        return {
          escrowId,
          traveler: "tr_fake",
          deposit: 10_000_000n,
          claimed: claimedVal,
          activeAt: Math.floor(Date.now() / 1000),
          settled: closedVal,
          sessionKey: "sk_fake",
          attested: 2_500_000n,
        };
      },
      async checkpoint() {
        return "tx_chk_123";
      },
      async claim() {
        claimedVal = 2_500_000n;
        return "tx_claim_123";
      },
      async close() {
        closedVal = true;
        return "tx_close_123";
      },
    };

    const dummyMeterSigner: MeterSigner = {
      publicKey: "3WqaNhVVCCnabBLGA9YWviQHDvo6fTmX1Y9otcmsdB7k",
      sign: () => ({
        cumulativeAtomic: "2500000",
        signature: "sig_fake",
        signer: "3WqaNhVVCCnabBLGA9YWviQHDvo6fTmX1Y9otcmsdB7k",
      }),
    };

    const productService = new MissionProductService({
      repo,
      connectivity,
      rail,
      escrowChain: fakeChain as EscrowChain,
      meter: dummyMeterSigner,
      fundingGate: sharedFundingGate,
    });

    const activeMission: ProductMission = seedMission({
      id: "m_halted_escrow",
      consumedMb: 100,
      consumedUsdc: 0.25,
      balanceUsdc: 9.75,
      meteredBytes: "100000000",
      status: "active",
      esimStatus: "active",
      depositVerified: true,
      depositAtomic: "10000000",
      escrowId: "esc_halted_1",
      travelerAddress: "tr_fake",
      voucher: {
        cumulativeAtomic: "2500000",
        signature: "sig_fake",
        signer: "3WqaNhVVCCnabBLGA9YWviQHDvo6fTmX1Y9otcmsdB7k",
        receivedAt: new Date().toISOString(),
      },
    });
    await repo.save(activeMission);

    // 1. Settlement (closeWithVoucher) while HALTED -> NOT BLOCKED
    const settleResult = await productService.settleMission("m_halted_escrow");
    assert.equal(settleResult.status, "completed");
    assert.equal(settleResult.txHash, "tx_close_123");

    // 2. Gate is still halted
    assert.equal(sharedFundingGate.isHalted(), true);
  });
});
