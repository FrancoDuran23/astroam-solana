import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VoucherTransportError,
  buildMessage1,
  createHttpVoucherPort,
  createInMemoryVoucherPort,
  withVoucherRetry,
  type VoucherPort,
} from "./voucher-port.ts";
import { buildUnsigned, message1Schema, type Message1, type Message2 } from "../shared/messages.ts";

const NETWORK = "monad:testnet" as const;
const CHANNEL = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const GATEWAY_TOKEN = "meter-test-gateway-token";
const PRICE_PER_MIB_RAW = 1_048_576n; // 1 raw per byte: amounts that are easy to read

function m1(cumulativeBytes: number, overrides: Partial<Message1> = {}): Message1 {
  return {
    ...buildMessage1({
      sessionId: "sess_1",
      channel: CHANNEL,
      network: NETWORK,
      cumulativeBytes,
      pricePerMibRaw: PRICE_PER_MIB_RAW,
      meterReadingId: `mr_${cumulativeBytes}`,
      observedAt: new Date("2026-09-23T12:00:00.000Z"),
    }),
    ...overrides,
  };
}

function unsigned(reason: Parameters<typeof buildUnsigned>[0], meterReadingId = "mr_1"): Message2 {
  return buildUnsigned(reason, {
    sessionId: "sess_1",
    channel: CHANNEL,
    remaining: "0",
    meterReadingId,
    detail: `test ${reason}`,
  }).body;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const noSleep = async () => {};

// --- buildMessage1 ----------------------------------------------------------

test("buildMessage1: builds a valid M1 with the amount from the shared function (ceilDiv per MiB)", () => {
  const message = buildMessage1({
    sessionId: "sess_1",
    channel: CHANNEL,
    network: NETWORK,
    cumulativeBytes: 1_048_577,
    pricePerMibRaw: 10_000n,
    meterReadingId: "mr_1",
    observedAt: new Date("2026-09-23T12:00:00.000Z"),
  });
  assert.equal(message1Schema.safeParse(message).success, true);
  // 1 MiB + 1 byte a 10_000 raw/MiB → ceil = 10_001 (AC-R2)
  assert.equal(message.cumulativeAmount, "10001");
  assert.equal(message.channel, CHANNEL);
  assert.equal(message.asset, "USDC");
  assert.equal(message.observedAt, "2026-09-23T12:00:00.000Z");
});

test("createHttpVoucherPort: sends POST with X-Gateway-Token and the M1 as JSON", async () => {
  let captured: { url: string; init: RequestInit | undefined } | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    captured = { url: String(input), init };
    return jsonResponse(503, unsigned("upstream_unavailable"));
  };
  const port = createHttpVoucherPort({ url: "http://agent.test/vouchers", gatewayToken: GATEWAY_TOKEN, fetch: fakeFetch });
  const reading = m1(2_000_000);
  const result = await port.requestVoucher(reading);

  assert.ok(captured);
  assert.equal(captured.url, "http://agent.test/vouchers");
  assert.equal(captured.init?.method, "POST");
  const headers = captured.init?.headers as Record<string, string>;
  assert.equal(headers["x-gateway-token"], GATEWAY_TOKEN);
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(captured.init?.body)), reading);

  // 503 with a valid M2 envelope: returned as is, explicit retryable
  assert.equal(result.status, "unsigned");
  if (result.status !== "unsigned") return;
  assert.equal(result.reason, "upstream_unavailable");
  assert.equal(result.retryable, true);
});

test("createHttpVoucherPort: maps non-M2 responses to VoucherTransportError with the right retryable", async () => {
  const cases: Array<{ name: string; response: () => Response; retryable: boolean; status?: number }> = [
    { name: "400 schema", response: () => jsonResponse(400, { error: "invalid message1 body" }), retryable: false, status: 400 },
    { name: "401 token", response: () => jsonResponse(401, { error: "missing" }), retryable: false, status: 401 },
    { name: "404", response: () => jsonResponse(404, { error: "not found" }), retryable: false, status: 404 },
    { name: "200 without M2", response: () => jsonResponse(200, { ok: true }), retryable: false, status: 200 },
    { name: "503 without M2 (proxy)", response: () => new Response("Service Unavailable", { status: 503 }), retryable: true, status: 503 },
    { name: "502 gateway", response: () => new Response("Bad Gateway", { status: 502 }), retryable: true, status: 502 },
  ];
  for (const c of cases) {
    const port = createHttpVoucherPort({
      url: "http://agent.test/vouchers",
      gatewayToken: GATEWAY_TOKEN,
      fetch: async () => c.response(),
    });
    await assert.rejects(
      () => port.requestVoucher(m1(1_000_000)),
      (error: unknown) =>
        error instanceof VoucherTransportError && error.retryable === c.retryable && error.httpStatus === c.status,
      c.name,
    );
  }
});

test("createHttpVoucherPort: network error → retryable VoucherTransportError", async () => {
  const port = createHttpVoucherPort({
    url: "http://agent.test/vouchers",
    gatewayToken: GATEWAY_TOKEN,
    fetch: async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    },
  });
  await assert.rejects(
    () => port.requestVoucher(m1(1_000_000)),
    (error: unknown) => error instanceof VoucherTransportError && error.retryable === true,
  );
});

test("createHttpVoucherPort: an invalid M1 fails before reaching the network (not retryable)", async () => {
  let fetchCalls = 0;
  const port = createHttpVoucherPort({
    url: "http://agent.test/vouchers",
    gatewayToken: GATEWAY_TOKEN,
    fetch: async () => {
      fetchCalls++;
      return jsonResponse(200, {});
    },
  });
  await assert.rejects(
    () => port.requestVoucher(m1(1_000_000, { channel: "C_CANAL_INVALIDO" })),
    (error: unknown) => error instanceof VoucherTransportError && error.retryable === false,
  );
  assert.equal(fetchCalls, 0);
});

// --- withVoucherRetry ----------------------------------------------------------

function scriptedPort(steps: Array<Message2 | Error>): VoucherPort & { calls: number } {
  const port = {
    calls: 0,
    async requestVoucher(): Promise<Message2> {
      const step = steps[Math.min(port.calls, steps.length - 1)]!;
      port.calls++;
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return port;
}

test("withVoucherRetry: retries a retryable M2 until it gets the signed voucher", async () => {
  const signed = await createInMemoryVoucherPort({ depositRaw: 10_000_000n }).requestVoucher(m1(1_000_000));
  const inner = scriptedPort([unsigned("upstream_unavailable"), unsigned("signer_unavailable"), signed]);
  const result = await withVoucherRetry(inner, { sleep: noSleep }).requestVoucher(m1(1_000_000));
  assert.equal(result.status, "signed");
  assert.equal(inner.calls, 3);
});

test("withVoucherRetry: NEVER retries a non-retryable M2", async () => {
  const inner = scriptedPort([unsigned("channel_exhausted"), unsigned("upstream_unavailable")]);
  const result = await withVoucherRetry(inner, { sleep: noSleep }).requestVoucher(m1(1_000_000));
  assert.equal(result.status, "unsigned");
  if (result.status !== "unsigned") return;
  assert.equal(result.reason, "channel_exhausted");
  assert.equal(inner.calls, 1);
});

test("withVoucherRetry: once the attempts run out it returns the last retryable M2", async () => {
  const inner = scriptedPort([unsigned("internal_error")]);
  const result = await withVoucherRetry(inner, { sleep: noSleep, maxAttempts: 3 }).requestVoucher(m1(1_000_000));
  assert.equal(result.status, "unsigned");
  if (result.status !== "unsigned") return;
  assert.equal(result.reason, "internal_error");
  assert.equal(result.retryable, true);
  assert.equal(inner.calls, 3);
});

test("withVoucherRetry: retries retryable transport failures, not configuration ones", async () => {
  const signed = await createInMemoryVoucherPort({ depositRaw: 10_000_000n }).requestVoucher(m1(1_000_000));
  const flaky = scriptedPort([new VoucherTransportError("ECONNRESET", { retryable: true }), signed]);
  const ok = await withVoucherRetry(flaky, { sleep: noSleep }).requestVoucher(m1(1_000_000));
  assert.equal(ok.status, "signed");
  assert.equal(flaky.calls, 2);

  const misconfigured = scriptedPort([new VoucherTransportError("401", { retryable: false, httpStatus: 401 }), signed]);
  await assert.rejects(
    () => withVoucherRetry(misconfigured, { sleep: noSleep }).requestVoucher(m1(1_000_000)),
    VoucherTransportError,
  );
  assert.equal(misconfigured.calls, 1);
});

test("withVoucherRetry: the deadline cuts in and returns the last retryable M2 seen", async () => {
  let clock = 0;
  const inner = scriptedPort([unsigned("upstream_unavailable")]);
  const result = await withVoucherRetry(inner, {
    deadlineMs: 1_000,
    now: () => clock,
    random: () => 1,
    sleep: async (ms) => {
      clock += ms;
    },
  }).requestVoucher(m1(1_000_000));
  assert.equal(result.status, "unsigned");
  if (result.status !== "unsigned") return;
  assert.equal(result.reason, "upstream_unavailable");
  assert.ok(inner.calls < 4, `must cut before using up the 4 attempts (made ${inner.calls})`);
});

// --- createInMemoryVoucherPort ---------------------------------------------------

test("createInMemoryVoucherPort: signs, reuses, rejects stale and exhausts against the deposit", async () => {
  const port = createInMemoryVoucherPort({ depositRaw: 3_000_000n });

  const first = await port.requestVoucher(m1(2_000_000));
  assert.equal(first.status, "signed");
  if (first.status !== "signed") return;
  assert.equal(first.reused, false);
  assert.equal(first.remaining, "1000000");

  const reused = await port.requestVoucher(m1(2_000_000));
  assert.equal(reused.status, "signed");
  if (reused.status !== "signed") return;
  assert.equal(reused.reused, true);
  assert.equal(reused.voucher.signature, first.voucher.signature);

  const stale = await port.requestVoucher(m1(1_000_000));
  assert.equal(stale.status, "unsigned");
  if (stale.status !== "unsigned") return;
  assert.equal(stale.reason, "stale_reading");
  assert.equal(stale.retryable, false);

  const exhausted = await port.requestVoucher(m1(3_000_001));
  assert.equal(exhausted.status, "unsigned");
  if (exhausted.status !== "unsigned") return;
  assert.equal(exhausted.reason, "channel_exhausted");
  assert.equal(exhausted.remaining, "1000000");
});
