// The automatic fund flow, end to end against in-memory doubles: the deposit
// is read from the escrow, the eSIM is funded one tranche ahead of the
// vouchers, AstroAm collects with claims, and the backend sends the close.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { MissionProductService } from "./services/MissionProductService.ts";
import { DEFAULT_FUND_FLOW, costCentsPaidBy, nextFundCents } from "./services/fund-flow.ts";
import type { MissionRepository } from "./persistence/MissionRepository.ts";
import type { ProductMission } from "./types/mission.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { FakeRail } from "../rails/FakeRail.ts";
import { FakeEscrowChain } from "../solana/FakeEscrowChain.ts";
import type { MeterSigner } from "../solana/meter-signer.ts";
import { runFundFlowOnce } from "../jobs/fund-flow.ts";
import { FakeTreasury } from "../treasury/TreasuryRouter.ts";
import { decodeBase58, encodeBase58 } from "../shared/solana/base58.ts";
import { closeVoucherMessage } from "../shared/solana/voucher.ts";
import type { SignedVoucher } from "../shared/solana/escrow.ts";

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

const BRASIL = { id: "br", name: "Brasil", flag: "BR", network: "Vivo", coverage: "4G/5G", pricePerMbUsdc: 0.0025 };
const PROGRAM = encodeBase58(new Uint8Array(32).fill(0x11));
const PAYEE = encodeBase58(new Uint8Array(32).fill(0x33));
const TRAVELER = encodeBase58(new Uint8Array(32).fill(0x44));
const TREASURY = encodeBase58(new Uint8Array(32).fill(0x66));
const MB = 1_000_000;

type Key = { address: string; privateKey: KeyObject };

function newKey(): Key {
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  return { address: encodeBase58(new Uint8Array(raw)), privateKey: pair.privateKey };
}

function signVoucher(key: Key, escrowId: string, atomic: bigint): SignedVoucher {
  const message = closeVoucherMessage(decodeBase58(PROGRAM), decodeBase58(escrowId), atomic);
  return {
    cumulativeAtomic: atomic.toString(),
    signature: sign(null, message, key.privateKey).toString("base64"),
    signer: key.address,
  };
}

let service: MissionProductService;
let provider: FakeProvider;
let chain: FakeEscrowChain;
let clock: Date;
let meter: Key;

function asMeter(key: Key): MeterSigner {
  return {
    publicKey: key.address,
    sign(_programId, escrowId, cumulativeAtomic) {
      return signVoucher(key, escrowId, cumulativeAtomic);
    },
  };
}

before(() => {
  process.env.ENABLE_DEMO_TRAFFIC = "true";
  process.env.SOLANA_PROGRAM_ID = PROGRAM;
  process.env.SOLANA_PAYEE_ADDRESS = PAYEE;
  process.env.SOLANA_ESCROW_SESSION_KEYS = "true";
  delete process.env.ASTROAM_LIVE_ENABLED;
  delete process.env.PRICE_PER_MB_RAW;
});

after(() => {
  delete process.env.SOLANA_PROGRAM_ID;
  delete process.env.SOLANA_PAYEE_ADDRESS;
  delete process.env.SOLANA_ESCROW_SESSION_KEYS;
});

beforeEach(() => {
  clock = new Date("2026-10-05T12:00:00Z");
  meter = newKey();
  provider = new FakeProvider();
  chain = new FakeEscrowChain(PROGRAM, meter.address, () => clock);
  service = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: provider,
    rail: new FakeRail(),
    escrowChain: chain,
    meter: asMeter(meter),
    depositReadRetryMs: 1,
    logger: () => {},
  });
});

/** A paid and activated trip whose deposit and session key are in the escrow. */
async function openTrip(budgetUsdc = 10, endDate = "2026-10-12") {
  const session = newKey();
  const created = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-05",
    endDate,
    budgetUsdc,
    dailyLimitUsdc: budgetUsdc,
  });
  const intent = await service.createPaymentIntent(created.id);
  chain.deposit({
    escrowId: intent.solana.escrowId,
    traveler: TRAVELER,
    amount: BigInt(intent.solana.amount),
    sessionKey: session.address,
  });
  await service.confirmPayment(created.id, intent.intentId, "deposit-tx");
  const activated = await service.activateMission(created.id);
  return { id: created.id, escrowId: intent.solana.escrowId, session, iccid: activated.esim.iccid };
}

/** Meters `mb` more megabytes and has the app sign the voucher for the new total. */
async function useAndSign(trip: Awaited<ReturnType<typeof openTrip>>, mb: number) {
  await service.processDemoTraffic(trip.id, mb * MB);
  const request = await service.voucherRequest(trip.id);
  return service.submitVoucher(trip.id, signVoucher(meter, trip.escrowId, BigInt(request.cumulativeAtomic)));
}

test("the tranche rule: one tranche past the voucher, never past what the deposit pays for", () => {
  // 10 USDC at a 1.5x markup pays for $6.66 of eSIM wallet.
  assert.equal(costCentsPaidBy(10_000_000n, DEFAULT_FUND_FLOW), 666);
  const fund = (voucherAtomic: bigint, fundedCents: number) =>
    nextFundCents({ depositAtomic: 10_000_000n, voucherAtomic, fundedCents }, DEFAULT_FUND_FLOW);
  assert.equal(fund(0n, 0), 250);
  assert.equal(fund(0n, 250), 0);
  assert.equal(fund(3_000_000n, 250), 200);
  // A gap under 50 cents is not worth a provider call.
  assert.equal(fund(300_000n, 250), 0);
  assert.equal(fund(10_000_000n, 450), 216);
  assert.equal(fund(10_000_000n, 666), 0);
});

test("the deposit is read from the escrow: traveler and session key come from the chain", async () => {
  const trip = await openTrip();
  const mission = await service.getMission(trip.id);
  assert.equal(mission.depositVerified, true);
  assert.equal(mission.travelerAddress, TRAVELER);
  assert.equal(mission.sessionKey, trip.session.address);
  assert.equal(mission.escrowActiveAt, "2026-10-05T12:00:00.000Z");
  const caps = await service.getCapabilities();
  assert.equal(caps.escrowSessionKeys, true);
  assert.equal(caps.escrowMeter, true);
  assert.equal(caps.escrowAutomation, true);
  assert.equal(caps.escrowOperator, chain.operator);
});

test("a deposit that is not in the escrow is refused, and the same intent works once it lands", async () => {
  const created = await service.createMission({ destination: BRASIL, startDate: "2026-10-05", endDate: "2026-10-12", budgetUsdc: 5, dailyLimitUsdc: 5 });
  const intent = await service.createPaymentIntent(created.id);
  await assert.rejects(service.confirmPayment(created.id, intent.intentId, "made-up-hash"), /not in the escrow yet/);
  assert.equal((await service.getMission(created.id)).paymentStatus, "pending");

  chain.deposit({ escrowId: intent.solana.escrowId, traveler: TRAVELER, amount: 5_000_000n });
  const confirmed = await service.confirmPayment(created.id, intent.intentId, "deposit-tx");
  assert.equal(confirmed.valid, true);
  assert.equal(confirmed.depositVerified, true);
});

test("an escrow holding less than the trip costs is refused", async () => {
  const created = await service.createMission({ destination: BRASIL, startDate: "2026-10-05", endDate: "2026-10-12", budgetUsdc: 5, dailyLimitUsdc: 5 });
  const intent = await service.createPaymentIntent(created.id);
  chain.deposit({ escrowId: intent.solana.escrowId, traveler: TRAVELER, amount: 1_000_000n });
  await assert.rejects(service.confirmPayment(created.id, intent.intentId, "short-deposit"), /this trip needs 5/);
});

test("activation funds one tranche, not the whole deposit", async () => {
  const trip = await openTrip();
  assert.deepEqual(provider.sim(trip.iccid).fundingRequests.map((f) => f.amountCents), [250]);
  assert.equal((await service.getMission(trip.id)).fundedCents, 250);
});

test("each voucher funds the next part, so the wallet stays one tranche ahead and stops at the deposit", async () => {
  const trip = await openTrip();

  // 400 MB = 1 USDC, which pays for 66 cents of provider cost.
  let res = await useAndSign(trip, 400);
  assert.equal(res.cumulativeAtomic, "1000000");
  assert.equal(res.fundedNowCents, 66);
  assert.equal(res.fundedCents, 316);

  // 1200 MB = 3 USDC covers 200 cents: funded goes to 450.
  res = await useAndSign(trip, 800);
  assert.equal(res.fundedCents, 450);

  // 3600 MB = 9 USDC covers 600 cents; the deposit pays for 666 in total.
  res = await useAndSign(trip, 2400);
  assert.equal(res.fundedCents, 666);
  assert.equal(provider.sim(trip.iccid).fundingRequests.reduce((n, f) => n + f.amountCents, 0), 666);
});

test("the meter attests usage on the next pass, and funding stays within what the deposit pays for", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 2000 * MB); // 5 USDC
  const pass = await service.advance(trip.id, clock);
  // 5 USDC pays for 333 cents of provider cost, plus one tranche, from the 250 already funded.
  assert.equal(pass.fundedCents, 333);
  assert.equal((await service.getMission(trip.id)).fundedCents, 583);
  const escrow = await chain.readEscrow(trip.escrowId);
  assert.equal(escrow?.attested, 5_000_000n);
  // 5 USDC is above CLAIM_MIN_USDC, so this pass also collects it. The other 5 stays deposited.
  assert.equal(chain.payeeBalance, 5_000_000n);
  assert.equal(escrow?.deposit, 10_000_000n);
  assert.equal(escrow?.claimed, 5_000_000n);
});

test("without a meter key, metered usage is not attested and nothing more is funded", async () => {
  const localProvider = new FakeProvider();
  const localChain = new FakeEscrowChain(PROGRAM, meter.address, () => clock);
  const bare = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: localProvider,
    rail: new FakeRail(),
    escrowChain: localChain,
    depositReadRetryMs: 1,
    logger: () => {},
  });
  const created = await bare.createMission({
    destination: BRASIL,
    startDate: "2026-10-05",
    endDate: "2026-10-12",
    budgetUsdc: 10,
    dailyLimitUsdc: 10,
  });
  const intent = await bare.createPaymentIntent(created.id);
  localChain.deposit({ escrowId: intent.solana.escrowId, traveler: TRAVELER, amount: BigInt(intent.solana.amount) });
  await bare.confirmPayment(created.id, intent.intentId, "deposit-tx");
  await bare.activateMission(created.id);
  await bare.processDemoTraffic(created.id, 2000 * MB);
  const pass = await bare.advance(created.id, clock);
  assert.equal(pass.fundedCents, 0);
  assert.equal((await bare.getMission(created.id)).fundedCents, 250);
  assert.equal((await bare.getMission(created.id)).voucher, undefined);
  assert.equal((await localChain.readEscrow(intent.solana.escrowId))?.attested, 0n);
});

test("a voucher is refused when the signer, the amount or the signature is wrong", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 400 * MB);

  const stranger = newKey();
  await assert.rejects(service.submitVoucher(trip.id, signVoucher(stranger, trip.escrowId, 1_000_000n)), /not signed by the meter/);
  await assert.rejects(service.submitVoucher(trip.id, signVoucher(trip.session, trip.escrowId, 1_000_000n)), /not signed by the meter/);
  await assert.rejects(service.submitVoucher(trip.id, signVoucher(meter, trip.escrowId, 1_000_001n)), /more than the metered usage/);
  await assert.rejects(service.submitVoucher(trip.id, signVoucher(meter, trip.escrowId, 10_000_001n)), /more than the deposit/);
  const tampered = { ...signVoucher(meter, trip.escrowId, 900_000n), cumulativeAtomic: "1000000" };
  await assert.rejects(service.submitVoucher(trip.id, tampered), /does not verify/);

  await service.submitVoucher(trip.id, signVoucher(meter, trip.escrowId, 1_000_000n));
  await assert.rejects(service.submitVoucher(trip.id, signVoucher(meter, trip.escrowId, 500_000n)), /higher voucher was already received/);
  assert.equal((await service.voucherRequest(trip.id)).signedAtomic, "1000000");
});

test("the job claims once the voucher holds a tranche, and the claim restarts the timeout", async () => {
  const trip = await openTrip();
  await useAndSign(trip, 400); // 1 USDC: under the 2 USDC claim threshold
  let pass = await service.advance(trip.id, clock);
  assert.equal(pass.claimTxHash, undefined);
  assert.equal(chain.payeeBalance, 0n);
  assert.equal((await chain.readEscrow(trip.escrowId))?.attested, 1_000_000n);

  await useAndSign(trip, 800); // 3 USDC
  clock = new Date("2026-10-06T12:00:00Z");
  pass = await service.advance(trip.id, clock);
  assert.ok(pass.claimTxHash);
  assert.equal(chain.payeeBalance, 3_000_000n);

  const mission = await service.getMission(trip.id);
  assert.equal(mission.claimedAtomic, "3000000");
  assert.equal(mission.claims?.length, 1);
  assert.equal(mission.status, "active");
  assert.equal(mission.escrowActiveAt, "2026-10-06T12:00:00.000Z");

  // Same voucher, next tick: nothing left to claim.
  pass = await service.advance(trip.id, clock);
  assert.equal(pass.claimTxHash, undefined);
  assert.equal(chain.payeeBalance, 3_000_000n);
});

test("the traveler ends the trip and the backend closes with the meter voucher", async () => {
  const trip = await openTrip();
  await useAndSign(trip, 1200); // 3 USDC
  await service.advance(trip.id, clock); // claims 3 USDC
  await service.processDemoTraffic(trip.id, 200 * MB); // 3.5 USDC in total

  const quote = await service.voucherRequest(trip.id);
  assert.equal(quote.cumulativeAtomic, "3500000");
  const closed = await service.settleMission(trip.id);

  assert.equal(closed.status, "completed");
  assert.ok(closed.txHash);
  assert.equal(closed.settledUsdc, 3.5);
  assert.equal(closed.refundedUsdc, 6.5);
  assert.equal(chain.payeeBalance, 3_500_000n);
  assert.equal(chain.refunds.get(TRAVELER), 6_500_000n);
  assert.equal((await chain.readEscrow(trip.escrowId))?.settled, true);
  assert.equal(provider.sim(trip.iccid).defundPending, true);

  // Asking again returns the same close instead of sending another.
  const again = await service.settleMission(trip.id);
  assert.equal(again.txHash, closed.txHash);
  assert.equal(chain.payeeBalance, 3_500_000n);
});

test("the backend closes by itself a day before the escrow's refund timeout", async () => {
  const trip = await openTrip(10, "2026-11-30");
  await useAndSign(trip, 400); // 1 USDC, never claimed

  let pass = await service.advance(trip.id, new Date("2026-10-11T11:00:00Z"));
  assert.equal(pass.closeReason, undefined);

  // Deposit at 12:00 on the 5th, 7-day timeout: the refund opens at 12:00 on the 12th.
  pass = await service.advance(trip.id, new Date("2026-10-11T12:00:00Z"));
  assert.equal(pass.closeReason, "timeout_near");
  assert.equal(chain.payeeBalance, 1_000_000n);
  assert.equal(chain.refunds.get(TRAVELER), 9_000_000n);
  const mission = await service.getMission(trip.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.autoCloseReason, "timeout_near");
});

test("the backend closes when the deposit is spent or the trip is over", async () => {
  const spent = await openTrip(5);
  await useAndSign(spent, 2000); // 5 USDC, the whole deposit
  let pass = await service.advance(spent.id, clock);
  assert.equal(pass.closeReason, "deposit_spent");
  assert.equal(chain.refunds.get(TRAVELER), 0n);

  const over = await openTrip(5, "2026-10-06");
  await useAndSign(over, 400);
  pass = await service.advance(over.id, new Date("2026-10-07T23:00:00Z"));
  assert.equal(pass.closeReason, undefined);
  pass = await service.advance(over.id, new Date("2026-10-08T00:00:00Z"));
  assert.equal(pass.closeReason, "trip_ended");
});

test("a trip due to close with no voucher is left to the escrow's timeout refund", async () => {
  const trip = await openTrip(5, "2026-10-06");
  const pass = await service.advance(trip.id, new Date("2026-10-09T00:00:00Z"));
  assert.equal(pass.closeReason, undefined);
  assert.equal(pass.error, undefined);
  assert.equal((await service.getMission(trip.id)).status, "active");
  assert.equal((await chain.readEscrow(trip.escrowId))?.settled, false);
});

test("a claim that landed but was not recorded is taken from the escrow, not sent twice", async () => {
  const trip = await openTrip();
  await useAndSign(trip, 1200); // 3 USDC
  const mission = await service.getMission(trip.id);
  // The claim reaches the chain, and the process dies before saving it.
  await chain.claim({ escrowId: trip.escrowId, voucher: mission.voucher! });

  const pass = await service.advance(trip.id, clock);
  assert.equal(pass.error, undefined);
  assert.equal(pass.claimTxHash, undefined);
  assert.equal(chain.payeeBalance, 3_000_000n);
  assert.equal((await service.getMission(trip.id)).claimedAtomic, "3000000");
});

test("what the provider charges becomes metered usage on the next pass", async () => {
  const trip = await openTrip();
  // $0.40 charged at a 1.5x markup is 0.60 USDC: 240 MB at 0.0025 USDC/MB.
  provider.setChargedUsd(trip.iccid, 400_000n);
  await service.advance(trip.id, clock);
  let mission = await service.getMission(trip.id);
  assert.equal(mission.meteredBytes, "240000000");
  assert.equal(mission.consumedUsdc, 0.6);
  assert.equal((await service.voucherRequest(trip.id)).cumulativeAtomic, "600000");

  // A lower reading never takes usage back.
  provider.setChargedUsd(trip.iccid, 100_000n);
  await service.advance(trip.id, clock);
  mission = await service.getMission(trip.id);
  assert.equal(mission.meteredBytes, "240000000");
});

test("the job advances every open trip and sweeps what was collected to the treasury", async () => {
  const one = await openTrip();
  const two = await openTrip();
  await useAndSign(one, 1200); // 3 USDC
  await useAndSign(two, 1600); // 4 USDC

  const fakeTreasury = new FakeTreasury({ minTransferAtomic: 5_000_000n, targetBufferAtomic: 0n, keepAtomic: 0n });
  const deps = {
    service,
    treasury: fakeTreasury,
    getPayeeBalanceAtomic: async () => chain.payeeBalance - fakeTreasury.totalRouted,
    now: () => clock,
  };
  const tick = await runFundFlowOnce(deps);
  assert.equal(tick.advanced.length, 2);
  assert.ok(tick.advanced.every((a) => a.claimTxHash));
  assert.ok(tick.treasuryResult?.moved);
  assert.equal(tick.treasuryResult?.amountAtomic, 7_000_000n);
  assert.equal(fakeTreasury.totalRouted, 7_000_000n);

  // Below the minimum, the next tick sweeps nothing.
  const tick2 = await runFundFlowOnce(deps);
  assert.equal(tick2.treasuryResult?.moved, false);
});

test("without an operator key the meter still signs, and the wallet can submit the close", async () => {
  const signing = asMeter(meter);
  const plain = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: new FakeProvider(),
    rail: new FakeRail(),
    meter: signing,
    logger: () => {},
  });
  const session = newKey();
  const created = await plain.createMission({ destination: BRASIL, startDate: "2026-10-05", endDate: "2026-10-12", budgetUsdc: 5, dailyLimitUsdc: 5 });
  const intent = await plain.createPaymentIntent(created.id);
  assert.equal(intent.solana.sessionKeys, true);
  await plain.confirmPayment(created.id, intent.intentId, "deposit-tx", TRAVELER, session.address);
  await plain.activateMission(created.id);
  await plain.processDemoTraffic(created.id, 250 * MB);

  const res = await plain.submitVoucher(created.id, signing.sign(PROGRAM, intent.solana.escrowId, 625_000n));
  assert.equal(res.cumulativeAtomic, "625000");
  // The deposit was not read from the chain, so no provider money moves on its word.
  assert.equal(res.fundedCents, 0);
  const caps = await plain.getCapabilities();
  assert.equal(caps.escrowAutomation, false);
  assert.equal(caps.escrowMeter, true);
  await assert.rejects(plain.submitVoucher(created.id, signVoucher(session, intent.solana.escrowId, 625_000n)), /not signed by the meter/);
  await assert.rejects(plain.settleMission(created.id), /503: No operator key/);
});

test("ending a trip does not need the traveler's signature", async () => {
  const trip = await openTrip();
  await useAndSign(trip, 400);
  await assert.rejects(service.settleMission(trip.id, signVoucher(newKey(), trip.escrowId, 1_000_000n)), /not signed by the meter/);
  assert.equal((await service.getMission(trip.id)).status, "active");
  const closed = await service.settleMission(trip.id);
  assert.equal(closed.status, "completed");
  assert.equal(closed.settledUsdc, 1);
  assert.equal(chain.payeeBalance, 1_000_000n);
  assert.equal(chain.refunds.get(TRAVELER), 9_000_000n);
});
