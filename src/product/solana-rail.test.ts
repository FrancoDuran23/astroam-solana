import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MissionProductService } from "./services/MissionProductService.ts";
import type { MissionRepository } from "./persistence/MissionRepository.ts";
import type { ProductMission } from "./types/mission.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { FakeRail } from "../rails/FakeRail.ts";
import { encodeBase58 } from "../shared/solana/base58.ts";
import { usdcToStellarRaw } from "../shared/solana/amounts.ts";

class MemoryRepo implements MissionRepository {
  private store = new Map<string, ProductMission>();

  async save(mission: ProductMission): Promise<void> {
    this.store.set(mission.id, structuredClone(mission));
  }

  async findById(id: string): Promise<ProductMission | null> {
    const mission = this.store.get(id);
    return mission ? structuredClone(mission) : null;
  }

  async findByPaymentIntentId(): Promise<ProductMission | null> {
    return null;
  }

  async findAll(): Promise<ProductMission[]> {
    return Array.from(this.store.values(), (mission) => structuredClone(mission));
  }
}

const BRASIL = {
  id: "br",
  name: "Brasil",
  flag: "BR",
  network: "Vivo",
  coverage: "4G/5G",
  pricePerMbUsdc: 0.0025,
};

const SIGNATURE = encodeBase58(new Uint8Array(64).fill(0xab));
const PROGRAM = encodeBase58(new Uint8Array(32).fill(0x11));
const PAYEE = encodeBase58(new Uint8Array(32).fill(0x33));
const TRAVELER = encodeBase58(new Uint8Array(32).fill(0x44));

let service: MissionProductService;

before(() => {
  process.env.ENABLE_DEMO_TRAFFIC = "true";
  delete process.env.ASTROAM_LIVE_ENABLED;
  delete process.env.SOLANA_PROGRAM_ID;
  delete process.env.SOLANA_PAYEE_ADDRESS;
  service = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: new FakeProvider(),
    rail: new FakeRail(),
  });
});

after(() => {
  delete process.env.SOLANA_PROGRAM_ID;
  delete process.env.SOLANA_PAYEE_ADDRESS;
});

test("the mission quotes the close in 6-decimal USDC and does not debit each MB", async () => {
  const { id } = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-01",
    endDate: "2026-10-04",
    budgetUsdc: 5,
    dailyLimitUsdc: 5,
  });
  const intent = await service.createPaymentIntent(id);
  assert.equal(intent.rail, "solana");
  assert.equal(intent.solana.amount, "5000000");
  assert.equal(intent.solana.usdcDecimals, 6);
  assert.equal(intent.solana.cluster, "devnet");
  assert.equal(intent.solana.usdcMint, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  assert.equal(intent.solana.deployed, false);

  await service.confirmPayment(id, intent.intentId, SIGNATURE, TRAVELER);
  await service.activateMission(id);

  const traffic = await service.processDemoTraffic(id, 1_000 * 1_000_000);
  assert.equal(traffic.demoTraffic, true);
  assert.equal(traffic.voucher.kind, "signed");

  const close = await service.finishMission(id);
  assert.equal(close.status, "awaiting_close");
  assert.equal(close.solana.cumulativeAmount, "2500000");
  assert.equal(close.solana.refundAtomic, "2500000");
  assert.notEqual(close.solana.cumulativeAmount, usdcToStellarRaw(2.5).toString());
  assert.equal(close.solana.messageBase64, null);

  const mission = await service.getMission(id);
  assert.equal(mission.status, "active");
  assert.equal(mission.depositExplorerUrl, `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`);
});

test("with the program configured the voucher points at that program id", async () => {
  process.env.SOLANA_PROGRAM_ID = PROGRAM;
  process.env.SOLANA_PAYEE_ADDRESS = PAYEE;
  const { id } = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    budgetUsdc: 1,
    dailyLimitUsdc: 1,
  });
  const intent = await service.createPaymentIntent(id);
  await service.confirmPayment(id, intent.intentId, SIGNATURE, TRAVELER);
  const close = await service.finishMission(id);
  assert.equal(close.solana.deployed, true);
  assert.equal(close.solana.programId, PROGRAM);
  assert.equal(close.solana.messageBase64 !== null, true);
  assert.equal(close.solana.cumulativeAmount, "0");
  const confirmed = await service.confirmClose(id, SIGNATURE, "close");
  assert.equal(confirmed.status, "completed");
  assert.equal(confirmed.explorerUrl, `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`);
  delete process.env.SOLANA_PROGRAM_ID;
  delete process.env.SOLANA_PAYEE_ADDRESS;
});
