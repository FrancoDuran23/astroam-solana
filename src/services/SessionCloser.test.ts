// Tests for SessionCloser (docs/citrus-mobile-spec.md v2 §7 R9): the persisted
// closing walk end-to-end against the FakeProvider + a real esim-record store
// (temp files). The meter is the real IntegratedMeterService with the
// in-memory voucher double; only the payment channel is faked (a ChannelBalancePort
// returning a fixed deposit + a closeChannel stub).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionCloser } from "./SessionCloser.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { openEsimStore, type EsimRecordRow } from "../persistence/esim-record.ts";
import { IntegratedMeterService } from "../meter/meter-service.ts";
import { createInMemoryVoucherPort } from "../meter/voucher-port.ts";
import { createConnectivitySession } from "../models/ConnectivitySession.ts";
import { pricePerMibFromPerMbRaw } from "../shared/money.ts";
import { equivalentBytes } from "../shared/usage-math.ts";
import type { CloseOutcome } from "../rails/PaymentRail.ts";
import { CitrusWebhookHandler } from "./CitrusWebhookHandler.ts";
import { WebhookEventLog } from "../persistence/webhook-event.ts";

const PRICE_PER_MB_RAW = 25_000n;
const VOUCHER_PRICE_PER_MIB_RAW = pricePerMibFromPerMbRaw(PRICE_PER_MB_RAW);
const DEPOSIT_RAW = 50_000_000n;
const MARKUP_BPS = 15000;
const USDC_USD_RATE_BPS = 10000;
const CHANNEL = "C-CLOSE-TEST-01";

type Harness = {
  store: ReturnType<typeof openEsimStore>;
  provider: FakeProvider;
  closer: SessionCloser;
  closeCalls: () => number;
  setCloseOutcome: (outcome: CloseOutcome) => void;
  iccid: string;
  now: () => Date;
};

async function buildHarness(over: {
  closeOutcome?: CloseOutcome;
  stableWindowMs?: number;
  row?: Partial<EsimRecordRow>;
  attestUsage?: (input: { iccid: string; equivalentBytes: bigint }) => Promise<void>;
} = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-closer-"));
  let clock = 1_700_000_000_000;
  const now = () => new Date(clock);
  const advance = (ms: number) => {
    clock += ms;
  };

  const store = openEsimStore(path.join(dir, "esim.json"));
  const provider = new FakeProvider(now);
  const iccid = (await provider.provisionEsim("user-1")).iccid;
  await provider.topUp(iccid, 500);
  provider.setChargedUsd(iccid, 1_000_000n);

  const baseRow: EsimRecordRow = {
    v: 1,
    iccid,
    userRef: "user-1",
    channelId: CHANNEL,
    status: "active",
    fundedMicroUsd: 5_000_000n,
    chargedBaselineMicroUsd: 1_000_000n,
    pendingFund: null,
    defundPending: false,
    defund: null,
    closing: null,
    lpaString: "LPA:1$fake.smdp$user-1",
    qrCode: "data:image/png;base64,qr",
    directInstallUrl: "https://direct",
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
    ...over.row,
  };
  await store.update(iccid, () => baseRow);

  const meter = new IntegratedMeterService({
    session: createConnectivitySession({ id: "trip-1", userId: "user-1", iccid, channelId: CHANNEL }),
    provider,
    balancePort: { getChannelBalance: async () => DEPOSIT_RAW },
    voucherPort: createInMemoryVoucherPort({ depositRaw: DEPOSIT_RAW, seed: "session-closer-test" }),
    network: "monad:testnet",
    voucherPricePerMibRaw: VOUCHER_PRICE_PER_MIB_RAW,
    pricePerMbRaw: PRICE_PER_MB_RAW,
    logger: () => {},
    now,
  });

  let calls = 0;
  let currentOutcome: CloseOutcome =
    over.closeOutcome ?? { kind: "closed", txHash: "0xtx", settledRaw: 20_000n, refundedRaw: 1_000n };
  const closer = new SessionCloser({
    provider,
    esimStore: store,
    meter,
    closeChannel: async () => {
      calls += 1;
      return currentOutcome;
    },
    markupBps: MARKUP_BPS,
    usdcUsdRateBps: USDC_USD_RATE_BPS,
    pricePerMbRaw: PRICE_PER_MB_RAW,
    stableWindowMs: over.stableWindowMs ?? 300_000,
    attestUsage: over.attestUsage,
    logger: () => {},
    now,
  });

  return {
    store,
    provider,
    closer,
    closeCalls: () => calls,
    setCloseOutcome: (outcome) => {
      currentOutcome = outcome;
    },
    iccid,
    now,
  };
}

test("full walk (fake + poll): defund → settlement → final voucher → channel closed → idle", async () => {
  const h = await buildHarness({ stableWindowMs: 0 });

  const started = await h.closer.beginClose(h.iccid);
  assert.deepEqual(started, { started: true, reason: "ok" });
  assert.equal(h.store.get(h.iccid)!.closing!.step, "defund_solicitado");

  // 1) Request the defund: the FakeProvider starts it and we record the 202.
  const solicited = await h.closer.runOnce(h.iccid);
  assert.equal(solicited.step, "defund_liquidado");
  assert.equal(h.provider.sim(h.iccid).defundPending, true);
  assert.equal(h.store.get(h.iccid)!.closing!.step, "defund_liquidado");

  // 2) Wait: the wallet is still funded → not settled yet.
  const waiting = await h.closer.runOnce(h.iccid);
  assert.equal(waiting.step, "defund_liquidado");
  assert.equal(waiting.settled, false);

  // 3) Citrus settles the defund (wallet → 0) and there was final usage.
  h.provider.settleDefund(h.iccid);
  h.provider.setChargedUsd(h.iccid, 2_600_000n);
  h.store.get(h.iccid); // fresh read below
  const settled = await h.closer.runOnce(h.iccid);
  assert.equal(settled.step, "canal_cerrado"); // advanceAfterSettlement runs the final voucher in the same step
  assert.equal(h.store.get(h.iccid)!.closing!.step, "canal_cerrado");

  // 4) Close the channel → done + idle state with a clean next exit.
  const done = await h.closer.runOnce(h.iccid);
  assert.equal(done.step, "done");
  assert.equal(h.closeCalls(), 1);
  const row = h.store.get(h.iccid)!;
  assert.equal(row.status, "idle");
  assert.equal(row.closing, null);
  assert.equal(row.defundPending, false);
  assert.equal(row.fundedMicroUsd, 0n);
  assert.equal(row.chargedBaselineMicroUsd, 0n);
  // The re-provisioned eSIM reuses the same row (R4/D8); the fake keeps defund null.
  assert.equal(row.defund, null);
  assert.equal(row.channelId, CHANNEL);
});

test("the webhook path settles by defund.settledAt and does not request the defund again", async () => {
  const now = new Date().toISOString();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-closer-webhook-"));
  const h = await buildHarness({
    stableWindowMs: 0,
    // As CitrusProvider.refundUnused would persist them: a pending defund
    // already stored with its metadata, not settled yet.
    row: {
      status: "defund_pending",
      defundPending: true,
      defund: {
        solicitedAt: now,
        settlesInMinutes: 15,
        estimatedReturnMicroUsd: 0n,
        returnedMicroUsd: null,
        settledAt: null,
      },
    },
  });

  // The close resumes at defund_liquidado (crash after the 202), without requesting again.
  const started = await h.closer.beginClose(h.iccid);
  assert.equal(started.started, true);
  assert.equal(h.store.get(h.iccid)!.closing!.step, "defund_liquidado");

  // The esim.defunded webhook stamps the settlement (that is the handler's role).
  const log = WebhookEventLog.open(path.join(dir, "events.jsonl"));
  const handler = new CitrusWebhookHandler({ log, esimStore: h.store, logger: () => {} });
  await handler.handle({
    id: "evt-def",
    event: "esim.defunded",
    created_at: now,
    data: { esim_id: h.iccid, returned_usd: 0.25 },
  });
  assert.notEqual(h.store.get(h.iccid)!.defund!.settledAt, null);

  // The next runOnce advances through the webhook path (defund.settledAt != null).
  const after = await h.closer.runOnce(h.iccid);
  assert.equal(after.step, "canal_cerrado");

  const done = await h.closer.runOnce(h.iccid);
  assert.equal(done.step, "done");
  const row = h.store.get(h.iccid)!;
  assert.equal(row.status, "idle");
  // The audit keeps the defund record with its refund.
  assert.equal(row.defund!.returnedMicroUsd, 250_000n);
  assert.notEqual(row.defund!.settledAt, null);
});

test("beginClose is idempotent: a close already started does not restart from zero", async () => {
  const h = await buildHarness();
  const first = await h.closer.beginClose(h.iccid);
  assert.equal(first.started, true);
  const second = await h.closer.beginClose(h.iccid);
  assert.deepEqual(second, { started: false, reason: "already_closing" });
  // The marker stays at defund_solicitado (the first step; it is not reset).
  assert.equal(h.store.get(h.iccid)!.closing!.step, "defund_solicitado");
});

test("beginClose resumes at defund_liquidado when the defund was already requested (crash) and does not request it again", async () => {
  const h = await buildHarness();
  // Crash after the refundUnused 202: defundPending persisted, row without closing.
  await h.store.update(h.iccid, (r) => ({ ...r!, defundPending: true }));
  const solicitedAtBefore = h.provider.sim(h.iccid).defundSolicitedAt;
  const started = await h.closer.beginClose(h.iccid);
  assert.equal(started.started, true);
  assert.equal(h.store.get(h.iccid)!.closing!.step, "defund_liquidado");

  // The waiting step does not call refundUnused again.
  await h.closer.runOnce(h.iccid);
  assert.equal(h.provider.sim(h.iccid).defundSolicitedAt, solicitedAtBefore);
});

test("runOnce with no row or no close in progress returns skipped", async () => {
  const h = await buildHarness();
  assert.deepEqual(await h.closer.runOnce("NO-SUCH"), { step: null, skipped: "no_row" });
  assert.deepEqual(await h.closer.runOnce(h.iccid), { step: null, skipped: "not_closing" });
});

test("a failed channel close keeps the canal_cerrado step so the operator can retry", async () => {
  const h = await buildHarness({
    closeOutcome: { kind: "blocked", reason: "funder_allowance_missing", detail: "no allowance" },
    row: { closing: { step: "canal_cerrado", startedAt: new Date().toISOString() } },
  });

  const first = await h.closer.runOnce(h.iccid);
  assert.equal(first.step, "canal_cerrado");
  assert.equal((first as { closeKind: string }).closeKind, "blocked");
  assert.equal(h.closeCalls(), 1);
  assert.equal(h.store.get(h.iccid)!.closing!.step, "canal_cerrado");

  const second = await h.closer.runOnce(h.iccid);
  assert.equal(second.step, "canal_cerrado");
  assert.equal(h.closeCalls(), 2);

  // The retry with an OK result finishes the path.
  h.setCloseOutcome({ kind: "closed", txHash: "0xok", settledRaw: 20_000n, refundedRaw: 1_000n });
  const done = await h.closer.runOnce(h.iccid);
  assert.equal(done.step, "done");
  assert.equal(h.store.get(h.iccid)!.status, "idle");
});

test("the final voucher attests the usage on the escrow before closing the channel", async () => {
  const calls: { iccid: string; equivalentBytes: bigint }[] = [];
  const h = await buildHarness({
    stableWindowMs: 0,
    attestUsage: async (input) => {
      calls.push(input);
    },
  });
  await h.closer.beginClose(h.iccid);
  await h.closer.runOnce(h.iccid);
  h.provider.settleDefund(h.iccid);
  h.provider.setChargedUsd(h.iccid, 2_600_000n);

  const attested = await h.closer.runOnce(h.iccid);
  assert.equal(attested.step, "canal_cerrado");
  assert.equal(h.closeCalls(), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.iccid, h.iccid);
  const charged = 2_600_000n - 1_000_000n;
  assert.equal(
    calls[0]!.equivalentBytes,
    equivalentBytes(charged, MARKUP_BPS, USDC_USD_RATE_BPS, PRICE_PER_MB_RAW),
  );
});

test("if the escrow checkpoint fails, the close does not advance and is retried", async () => {
  let fail = true;
  const h = await buildHarness({
    stableWindowMs: 0,
    attestUsage: async () => {
      if (fail) throw new Error("rpc down");
    },
  });
  await h.closer.beginClose(h.iccid);
  await h.closer.runOnce(h.iccid);
  h.provider.settleDefund(h.iccid);

  const stuck = await h.closer.runOnce(h.iccid);
  assert.equal(stuck.step, "ultimo_vale_firmado");
  assert.equal(h.store.get(h.iccid)!.closing!.step, "ultimo_vale_firmado");
  assert.equal(h.closeCalls(), 0);

  fail = false;
  const retried = await h.closer.runOnce(h.iccid);
  assert.equal(retried.step, "canal_cerrado");
  assert.equal(h.closeCalls(), 0);
});