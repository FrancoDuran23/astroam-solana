// Tests for FundingService (docs/citrus-mobile-spec.md v2 §7 R5): the single
// top-up to the ceiling `maxWalletCents` (I2), the crash/timeout RECONCILIATION
// against `pendingFund` + the wallet instead of a blind retry, and the policy:
// a definitive 400/401/404/409 rejection clears the durable intent and
// rethrows, while a retryable/timeout rejection KEEPS `pendingFund` as the
// durable record for the next run.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FundingService, MICRO_USD_PER_CENT } from "./FundingService.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { openEsimStore, type EsimRecordRow } from "../persistence/esim-record.ts";
import { maxWalletCents } from "../shared/usage-math.ts";
import { CitrusApiError } from "../shared/citrus-errors.ts";

const DEPOSIT_RAW = 50_000_000n;
const MARKUP_BPS = 15000;
const USDC_USD_RATE_BPS = 10000;
const CHANNEL = "C-FUND-01";
const MAX_CENTS = maxWalletCents(DEPOSIT_RAW, USDC_USD_RATE_BPS, MARKUP_BPS); // 333

type FundHarness = {
  store: ReturnType<typeof openEsimStore>;
  provider: FakeProvider;
  service: FundingService;
  stamped: Array<Record<string, unknown>>;
  iccid: string;
};

async function buildHarness(over: { row?: Partial<EsimRecordRow>; topUpError?: unknown; walletCents?: number } = {}): Promise<FundHarness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "funding-service-"));
  const store = openEsimStore(path.join(dir, "esim.json"));
  const provider = new FakeProvider();
  const iccid = (await provider.provisionEsim("user-1")).iccid;
  if (over.topUpError !== undefined) {
    provider.topUp = async (_iccid: string, _amountCents: number): Promise<void> => {
      throw over.topUpError;
    };
  }
  if (over.walletCents !== undefined) {
    await provider.topUp(iccid, over.walletCents);
  }
  const baseRow: EsimRecordRow = {
    v: 1,
    iccid,
    userRef: "user-1",
    channelId: CHANNEL,
    status: "active",
    fundedMicroUsd: 0n,
    chargedBaselineMicroUsd: 0n,
    pendingFund: null,
    defundPending: false,
    defund: null,
    closing: null,
    lpaString: "LPA:1$fake.smdp$user-1",
    qrCode: "data:image/png;base64,qr",
    directInstallUrl: "https://direct",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over.row,
  };
  await store.update(iccid, () => baseRow);

  const stamped: Array<Record<string, unknown>> = [];
  const service = new FundingService({
    provider,
    esimStore: store,
    balancePort: { getChannelBalance: async () => DEPOSIT_RAW },
    markupsBps: MARKUP_BPS,
    usdcUsdRateBps: USDC_USD_RATE_BPS,
    logger: (line) => stamped.push(line as Record<string, unknown>),
  });
  return { store, provider, service, stamped, iccid };
}

test("no row → no_row; with closing/defund/terminated → the provider is not touched", async () => {
  const h = await buildHarness();
  assert.deepEqual(await h.service.ensureFunded({ iccid: "no-row", userRef: "x", channelId: CHANNEL }), { funded: false, reason: "no_row" });

  await h.store.update(h.iccid, (r) => ({ ...r!, closing: { step: "defund_solicitado", startedAt: new Date().toISOString() } }));
  assert.deepEqual(await h.service.ensureFunded({ iccid: h.iccid, userRef: "user-1", channelId: CHANNEL }), { funded: false, reason: "closing" });

  await h.store.update(h.iccid, (r) => ({ ...r!, closing: null, defundPending: true }));
  assert.deepEqual(await h.service.ensureFunded({ iccid: h.iccid, userRef: "user-1", channelId: CHANNEL }), { funded: false, reason: "defund_pending" });
  assert.equal(h.provider.list()[0]!.fundingRequests.length, 0);
});

test("already funded to the ceiling → already_funded, no topUp", async () => {
  const h = await buildHarness({ row: { fundedMicroUsd: BigInt(MAX_CENTS) * MICRO_USD_PER_CENT } });
  const result = await h.service.ensureFunded({ iccid: h.iccid, userRef: "user-1", channelId: CHANNEL });
  assert.deepEqual(result, { funded: false, reason: "already_funded" });
  assert.equal(h.provider.sim(h.iccid).fundingRequests.length, 0);
});

test("funds the gap to the ceiling (full gap, I2) and confirms it", async () => {
  const h = await buildHarness();
  const result = await h.service.ensureFunded({ iccid: h.iccid, userRef: "user-1", channelId: CHANNEL });
  assert.deepEqual(result, { funded: true, amountCents: MAX_CENTS });
  const row = h.store.get(h.iccid)!;
  assert.equal(row.pendingFund, null);
  assert.equal(row.fundedMicroUsd, BigInt(MAX_CENTS) * MICRO_USD_PER_CENT);
  assert.equal(h.provider.sim(h.iccid).fundingRequests.length, 1);
  assert.equal(h.stamped.some((l) => l.reason === "wallet_funded" && l.source === "confirmed"), true);
});

test("R5 reconciliation: a pendingFund that LANDED is credited without funding again", async () => {
  // Crash after POST /fund but before confirming: the wallet already grew.
  const h = await buildHarness({
    walletCents: MAX_CENTS,
    row: {
      pendingFund: { amountCents: MAX_CENTS, walletBeforeCents: 0, requestedAt: "2026-09-24T10:00:00.000Z" },
    },
  });
  const result = await h.service.ensureFunded({ iccid: h.iccid, userRef: "user-1", channelId: CHANNEL });
  assert.deepEqual(result, { funded: false, reason: "already_funded" }); // the gap was covered by the reconciliation
  const row = h.store.get(h.iccid)!;
  assert.equal(row.pendingFund, null);
  assert.equal(row.fundedMicroUsd, BigInt(MAX_CENTS) * MICRO_USD_PER_CENT);
  assert.equal(h.provider.sim(h.iccid).fundingRequests.length, 1); // the topUp that had already happened
  assert.equal(h.stamped.some((l) => l.reason === "wallet_funded" && l.source === "reconciled"), true);
});

test("R5 reconciliation: a pendingFund that did NOT land is discarded and funded fresh", async () => {
  const h = await buildHarness({
    row: { pendingFund: { amountCents: MAX_CENTS, walletBeforeCents: 0, requestedAt: "2026-09-24T10:00:00.000Z" } },
  });
  const result = await h.service.ensureFunded({ iccid: h.iccid, userRef: "user-1", channelId: CHANNEL });
  assert.deepEqual(result, { funded: true, amountCents: MAX_CENTS });
  const row = h.store.get(h.iccid)!;
  assert.equal(row.pendingFund, null);
  assert.equal(row.fundedMicroUsd, BigInt(MAX_CENTS) * MICRO_USD_PER_CENT);
  assert.equal(h.stamped.some((l) => l.reason === "fund_intent_dropped"), true);
  assert.equal(h.provider.sim(h.iccid).fundingRequests.length, 1); // the fresh attempt
});

test("a definitive rejection (400/401/404/409) clears the durable attempt and rethrows", async () => {
  const h = await buildHarness({
    topUpError: new CitrusApiError(409, "CONFLICT", "the wallet has a pending defund", { retryable: false }),
  });
  await assert.rejects(h.service.ensureFunded({ iccid: h.iccid, userRef: "user-1", channelId: CHANNEL }));
  const row = h.store.get(h.iccid)!;
  assert.equal(row.pendingFund, null);
  assert.equal(row.fundedMicroUsd, 0n);
});

test("a retryable rejection/timeout does NOT clear the pendingFund (left to reconcile on the next run)", async () => {
  const h = await buildHarness({
    topUpError: new CitrusApiError(0, "REQUEST_TIMEOUT", "the fund hung", { retryable: true }),
  });
  await assert.rejects(h.service.ensureFunded({ iccid: h.iccid, userRef: "user-1", channelId: CHANNEL }));
  const row = h.store.get(h.iccid)!;
  assert.notEqual(row.pendingFund, null);
  assert.deepEqual(row.pendingFund!.amountCents, MAX_CENTS);
});