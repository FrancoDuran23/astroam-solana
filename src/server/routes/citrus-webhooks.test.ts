// Tests for POST /citrus/webhooks (docs/citrus-mobile-spec.md v2 §7 R10): raw
// body + HMAC verification over a real HTTP connection, live express app on an
// ephemeral port (same harness as server/app.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServerApp } from "../app.ts";
import { bootProductService } from "../../product/runtime/product-boot.ts";
import { WebhookEventLog } from "../../persistence/webhook-event.ts";
import { openEsimStore, type EsimRecordRow } from "../../persistence/esim-record.ts";
import { CitrusWebhookHandler } from "../../services/CitrusWebhookHandler.ts";

const SECRET = "whsec_route_test_0123456789abcdef";

function sign(body: string | Buffer, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function seedDefundPendingRow(iccid: string): EsimRecordRow {
  const now = new Date().toISOString();
  return {
    v: 1,
    iccid,
    userRef: `user_of_${iccid}`,
    channelId: "C-HTTP-TEST",
    status: "defund_pending",
    fundedMicroUsd: 5_000_000n,
    chargedBaselineMicroUsd: 1_000_000n,
    pendingFund: null,
    defundPending: true,
    defund: { solicitedAt: now, settlesInMinutes: 15, estimatedReturnMicroUsd: 0n, returnedMicroUsd: null, settledAt: null },
    closing: null,
    lpaString: "LPA:1$smdp$http",
    qrCode: "data:image/png;base64,qr",
    directInstallUrl: "https://direct",
    createdAt: now,
    updatedAt: now,
  };
}

async function withHooks(
  fn: (baseUrl: string, store: ReturnType<typeof openEsimStore>) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "citrus-webhooks-route-"));
  const store = openEsimStore(path.join(dir, "esim.json"));
  const log = WebhookEventLog.open(path.join(dir, "events.jsonl"));
  const handler = new CitrusWebhookHandler({ log, esimStore: store, logger: () => {} });
  const app = createServerApp({
    productService: bootProductService({ DATA_DIR: dir }),
    citrusWebhooks: { handler, secret: SECRET },
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`, store);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("valid webhook (correct signature) → 200 processed; the same id sent again → 200 duplicate", async () => {
  await withHooks(async (baseUrl) => {
    const body = JSON.stringify({
      id: "evt-1",
      event: "esim.usage_threshold",
      created_at: "2026-09-24T10:00:00.000Z",
      data: {},
    });
    const headers = { "content-type": "application/json", "x-citrus-signature": sign(body) };
    const first = await fetch(`${baseUrl}/citrus/webhooks`, { method: "POST", headers, body });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { received: true, handled: "processed" });

    const second = await fetch(`${baseUrl}/citrus/webhooks`, { method: "POST", headers, body });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { received: true, handled: "duplicate" });
  });
});

test("invalid or missing signature → 401, not processed", async () => {
  await withHooks(async (baseUrl) => {
    const body = JSON.stringify({ id: "evt-2", event: "esim.defunded", created_at: "x", data: {} });
    const bad = await fetch(`${baseUrl}/citrus/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-citrus-signature": sign(body, "whsec_other") },
      body,
    });
    assert.equal(bad.status, 401);

    const missing = await fetch(`${baseUrl}/citrus/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(missing.status, 401);
  });
});

test("malformed body with a correct signature → 200 (logged, never a redelivery loop)", async () => {
  await withHooks(async (baseUrl) => {
    const body = JSON.stringify({ whatever: true });
    const response = await fetch(`${baseUrl}/citrus/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-citrus-signature": sign(body) },
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, handled: "malformed" });
  });
});

test("esim.defunded: the webhook stamps the settlement in the store through full HTTP", async () => {
  await withHooks(async (baseUrl, store) => {
    const now = new Date().toISOString();
    const iccid = "HTTP-FUND-1";
    store.update(iccid, () => seedDefundPendingRow(iccid));
    const payload = {
      id: "evt-def-http",
      event: "esim.defunded",
      created_at: now,
      data: { esim_id: iccid, returned_usd: 0.5 },
    };
    const body = JSON.stringify(payload);
    const response = await fetch(`${baseUrl}/citrus/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-citrus-signature": sign(body) },
      body,
    });
    assert.equal(response.status, 200);
    const row = store.get(iccid)!;
    assert.notEqual(row.defund!.settledAt, null);
    assert.equal(row.defund!.returnedMicroUsd, 500_000n);
  });
});

test("the other routes stay intact with express.json() (the webhook's raw body does not affect them)", async () => {
  await withHooks(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
  });
});