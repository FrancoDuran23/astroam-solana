import { test } from "node:test";
import assert from "node:assert/strict";
import { IntegratedMeterService } from "./meter-service.ts";
import type { ConnectivityProvider, SimUsage } from "../providers/connectivity/ConnectivityProvider.ts";
import {
  createConnectivitySession,
  type ConnectivitySession,
} from "../models/ConnectivitySession.ts";
import { buildUnsigned, type Message1, type Message2 } from "../shared/messages.ts";
import {
  VoucherTransportError,
  createInMemoryVoucherPort,
  withVoucherRetry,
  type VoucherPort,
} from "./voucher-port.ts";

/** Channel id as an EVM rail formats it (the contract address). */
const CHANNEL = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
/** 1_048_576 raw/MiB = 1 raw/byte = 1_000_000 raw/MB: the same price as the
 * policy's `pricePerMbRaw: 1_000_000n`, expressed per MiB (CF-R2). */
const PRICE_PER_MIB_RAW = 1_048_576n;

function voucherOptions(depositRaw: bigint, voucherPort?: VoucherPort) {
  return {
    voucherPort: voucherPort ?? createInMemoryVoucherPort({ depositRaw }),
    network: "monad:testnet" as const,
    voucherPricePerMibRaw: PRICE_PER_MIB_RAW,
  };
}

const ACTIVE_USAGE: SimUsage = { chargedMicroUsd: 0n, walletMicroUsd: 0n, status: "active", asOf: "" };

test("IntegratedMeterService: processes traffic within the balance and keeps the connection active", async () => {
  let suspendedCalls = 0;

  const fakeProvider: ConnectivityProvider = {
    async provisionEsim() {
      throw new Error("not reached");
    },
    async topUp() {},
    async suspend() {
      suspendedCalls++;
    },
    async resume() {},
    async refundUnused() {},
    async terminate() {},
    async getUsage() {
      return ACTIVE_USAGE;
    },
  };

  const session: ConnectivitySession = createConnectivitySession({
    id: "sess_1",
    userId: "user_1",
    channelId: CHANNEL,
    iccid: "89551...",
  });

  const fakeBalancePort = {
    async getChannelBalance() {
      return 10_000_000n; // 1 USDC in raw units
    },
  };

  const service = new IntegratedMeterService({
    session,
    provider: fakeProvider,
    balancePort: fakeBalancePort,
    pricePerMbRaw: 1_000_000n, // 0.1 USDC per MB
    ...voucherOptions(10_000_000n),
    logger: () => {},
  });

  const res = await service.processTraffic(500_000); // 0.5 MB consumidos
  assert.equal(res.actionApplied.kind, "noop");
  assert.equal(suspendedCalls, 0);
  assert.equal(res.meterStatus.cumulativeBytes, 500_000);
  assert.equal(res.voucher.kind, "signed");
  assert.equal(res.meterStatus.paidQuotaBytes, 500_000);
});

test("IntegratedMeterService: suspends the eSIM if usage exhausts the channel balance", async () => {
  let suspendedIccid = "";

  const fakeProvider: ConnectivityProvider = {
    async provisionEsim() {
      throw new Error("not reached");
    },
    async topUp() {},
    async suspend(iccid: string) {
      suspendedIccid = iccid;
    },
    async resume() {},
    async refundUnused() {},
    async terminate() {},
    async getUsage() {
      return ACTIVE_USAGE;
    },
  };

  const session: ConnectivitySession = createConnectivitySession({
    id: "sess_1",
    userId: "user_1",
    channelId: CHANNEL,
    iccid: "89551...",
  });

  const fakeBalancePort = {
    async getChannelBalance() {
      return 1_000_000n; // Very small balance: 0.1 USDC (1 MB)
    },
  };

  const service = new IntegratedMeterService({
    session,
    provider: fakeProvider,
    balancePort: fakeBalancePort,
    pricePerMbRaw: 1_000_000n, // 0.1 USDC per MB
    ...voucherOptions(10_000_000n),
    logger: () => {},
  });

  // Use 2 MB (above the channel balance of 1 MB)
  const res = await service.processTraffic(2_000_000);
  assert.equal(res.actionApplied.kind, "suspend");
  assert.equal(suspendedIccid, "89551...");
});

// --- Integration with POST /vouchers (VoucherPort) --------------------------

type ProviderCalls = { suspended: string[] };

function recordingProvider(): ConnectivityProvider & { calls: ProviderCalls } {
  const calls: ProviderCalls = { suspended: [] };
  return {
    calls,
    async provisionEsim() {
      throw new Error("not reached");
    },
    async topUp() {},
    async suspend(iccid: string) {
      calls.suspended.push(iccid);
    },
    async resume() {},
    async refundUnused() {},
    async terminate() {},
    async getUsage() {
      return ACTIVE_USAGE;
    },
  };
}

function makeService(opts: {
  balanceRaw: bigint;
  voucherPort: VoucherPort;
  provider?: ConnectivityProvider;
}) {
  const provider = opts.provider ?? recordingProvider();
  const session = createConnectivitySession({
    id: "sess_v",
    userId: "user_1",
    channelId: CHANNEL,
    iccid: "89551...",
  });
  return new IntegratedMeterService({
    session,
    provider,
    balancePort: {
      async getChannelBalance() {
        return opts.balanceRaw;
      },
    },
    pricePerMbRaw: 1_000_000n,
    ...voucherOptions(opts.balanceRaw, opts.voucherPort),
    meterConfig: { maxUnpaidQuotaBytes: 1_000_000 },
    logger: () => {},
    now: () => new Date("2026-09-23T12:00:00.000Z"),
  });
}

/** Port that records every M1 and answers with whatever `respond` returns. */
function capturingPort(respond: (m1: Message1) => Promise<Message2> | Message2): VoucherPort & { sent: Message1[] } {
  const sent: Message1[] = [];
  return {
    sent,
    async requestVoucher(m1) {
      sent.push(m1);
      return respond(m1);
    },
  };
}

function unsignedFor(m1: Message1, reason: Parameters<typeof buildUnsigned>[0]): Message2 {
  return buildUnsigned(reason, {
    sessionId: m1.sessionId,
    channel: CHANNEL,
    remaining: "0",
    meterReadingId: m1.meterReadingId,
    detail: `test ${reason}`,
  }).body;
}

test("IntegratedMeterService: requests the voucher with the M1 of the total and credits only if the agent signs", async () => {
  const inner = createInMemoryVoucherPort({ depositRaw: 10_000_000n });
  const port = capturingPort((m1) => inner.requestVoucher(m1));
  const service = makeService({ balanceRaw: 10_000_000n, voucherPort: port });

  const first = await service.processTraffic(1_500_000);
  const second = await service.processTraffic(500_000);

  assert.equal(port.sent.length, 2);
  const [m1a, m1b] = port.sent;
  assert.equal(m1a!.channel, CHANNEL);
  assert.equal(m1a!.sessionId, "sess_v");
  assert.equal(m1a!.network, "monad:testnet");
  assert.equal(m1a!.cumulativeBytes, 1_500_000);
  assert.equal(m1a!.cumulativeAmount, "1500000"); // ceilDiv(bytes × PRICE_PER_MIB_RAW, 1 MiB)
  assert.equal(m1a!.observedAt, "2026-09-23T12:00:00.000Z");
  // Total since the channel opened (VE-R4), never the delta
  assert.equal(m1b!.cumulativeBytes, 2_000_000);
  assert.notEqual(m1a!.meterReadingId, m1b!.meterReadingId);

  assert.equal(first.voucher.kind, "signed");
  assert.equal(first.meterStatus.paidQuotaBytes, 1_500_000);
  assert.equal(second.voucher.kind, "signed");
  assert.equal(second.meterStatus.paidQuotaBytes, 2_000_000);
  assert.equal(second.meterStatus.isConnectionActive, true);
});

test("IntegratedMeterService: a non-retryable rejection does NOT credit and the meter ends up cutting", async () => {
  const provider = recordingProvider();
  const port = capturingPort((m1) => unsignedFor(m1, "channel_closing"));
  // Ample deposit: the policy has no reason to act.
  const service = makeService({ balanceRaw: 100_000_000n, voucherPort: port, provider });

  const first = await service.processTraffic(800_000);
  assert.equal(first.voucher.kind, "unsigned");
  assert.equal(first.actionApplied.kind, "noop");
  assert.equal(first.meterStatus.paidQuotaBytes, 0);
  assert.equal(first.meterStatus.isConnectionActive, true); // still within the unpaid quota

  // Without a voucher, usage exceeds the unpaid quota (1 MB) and the meter cuts.
  const second = await service.processTraffic(800_000);
  assert.equal(second.meterStatus.paidQuotaBytes, 0);
  assert.equal(second.meterStatus.isConnectionActive, false);
  // The policy does not change: with no exhausted deposit, it leaves the eSIM alone.
  assert.deepEqual(provider.calls, { suspended: [] });
});

test("IntegratedMeterService: channel_exhausted does not credit and the policy suspends the eSIM", async () => {
  const provider = recordingProvider();
  const service = makeService({
    balanceRaw: 1_000_000n, // 1 MB of deposit
    voucherPort: createInMemoryVoucherPort({ depositRaw: 1_000_000n }),
    provider,
  });

  const res = await service.processTraffic(2_000_000);
  assert.equal(res.voucher.kind, "unsigned");
  if (res.voucher.kind !== "unsigned") return;
  assert.equal(res.voucher.envelope.reason, "channel_exhausted");
  assert.equal(res.voucher.envelope.retryable, false);
  assert.equal(res.actionApplied.kind, "suspend");
  assert.deepEqual(provider.calls.suspended, ["89551..."]);
  assert.equal(res.meterStatus.paidQuotaBytes, 0);
  assert.equal(res.meterStatus.isConnectionActive, false);
});

// --- processCumulative (R8): the path of the usage loop / final voucher of the close ---

test("processCumulative: requests the voucher for the total, credits and does not suspend when the balance is enough", async () => {
  const provider = recordingProvider();
  const port = capturingPort((m1) => createInMemoryVoucherPort({ depositRaw: 10_000_000n }).requestVoucher(m1));
  const service = makeService({ balanceRaw: 10_000_000n, voucherPort: port, provider });

  // 1 500 000 equivalent bytes: 1.5 USDC of cost against 1 USDC×10 of deposit.
  const res = await service.processCumulative(1_500_000);

  assert.equal(port.sent.length, 1);
  assert.equal(port.sent[0]!.cumulativeBytes, 1_500_000);
  assert.equal(res.actionApplied.kind, "noop");
  assert.equal(res.voucher.kind, "signed");
  assert.equal(res.meterStatus.paidQuotaBytes, 1_500_000);
  // processCumulative does NOT record traffic: the total already comes from outside.
  assert.equal(res.meterStatus.cumulativeBytes, 0);
  assert.deepEqual(provider.calls.suspended, []);
});

test("processCumulative: suspends the eSIM when the channel runs out and does not credit", async () => {
  const provider = recordingProvider();
  // Small channel balance (0.1 USDC) but the agent does sign the voucher.
  const port = capturingPort((m1) => createInMemoryVoucherPort({ depositRaw: 10_000_000n }).requestVoucher(m1));
  const service = makeService({ balanceRaw: 1_000_000n, voucherPort: port, provider });

  const res = await service.processCumulative(2_000_000);

  assert.equal(res.actionApplied.kind, "suspend");
  assert.deepEqual(provider.calls.suspended, ["89551..."]);
  assert.equal(res.voucher.kind, "signed");
  assert.equal(res.meterStatus.paidQuotaBytes, 0, "no quota: the channel is exhausted");
});

test("IntegratedMeterService: retries a retryable reason and credits when the agent signs", async () => {
  const inner = createInMemoryVoucherPort({ depositRaw: 10_000_000n });
  let calls = 0;
  const flaky: VoucherPort = {
    async requestVoucher(m1) {
      calls++;
      if (calls === 1) return unsignedFor(m1, "upstream_unavailable");
      return inner.requestVoucher(m1);
    },
  };
  const service = makeService({
    balanceRaw: 10_000_000n,
    voucherPort: withVoucherRetry(flaky, { sleep: async () => {} }),
  });

  const res = await service.processTraffic(1_000_000);
  assert.equal(calls, 2);
  assert.equal(res.voucher.kind, "signed");
  assert.equal(res.meterStatus.paidQuotaBytes, 1_000_000);
});

test("IntegratedMeterService: if the retryable reason persists, it neither credits nor changes the policy", async () => {
  const provider = recordingProvider();
  const port = capturingPort((m1) => unsignedFor(m1, "signer_unavailable"));
  const service = makeService({
    balanceRaw: 10_000_000n,
    voucherPort: withVoucherRetry(port, { sleep: async () => {}, maxAttempts: 2 }),
    provider,
  });

  const res = await service.processTraffic(500_000);
  assert.equal(port.sent.length, 2);
  assert.equal(res.voucher.kind, "unsigned");
  if (res.voucher.kind !== "unsigned") return;
  assert.equal(res.voucher.envelope.retryable, true);
  assert.equal(res.actionApplied.kind, "noop");
  assert.equal(res.meterStatus.paidQuotaBytes, 0);
  assert.deepEqual(provider.calls, { suspended: [] });
});

test("IntegratedMeterService: a repeated reading uses the reused voucher and stays credited", async () => {
  const inner = createInMemoryVoucherPort({ depositRaw: 10_000_000n });
  const port = capturingPort((m1) => inner.requestVoucher(m1));
  const service = makeService({ balanceRaw: 10_000_000n, voucherPort: port });

  const first = await service.processTraffic(1_000_000);
  const repeat = await service.processTraffic(0); // same total: idempotent retry

  assert.equal(first.voucher.kind, "signed");
  assert.equal(repeat.voucher.kind, "signed");
  if (first.voucher.kind !== "signed" || repeat.voucher.kind !== "signed") return;
  assert.equal(first.voucher.envelope.reused, false);
  assert.equal(repeat.voucher.envelope.reused, true);
  assert.equal(repeat.voucher.envelope.voucher.signature, first.voucher.envelope.voucher.signature);
  assert.equal(port.sent[1]!.cumulativeAmount, port.sent[0]!.cumulativeAmount);
  assert.equal(repeat.meterStatus.paidQuotaBytes, 1_000_000);
});

test("IntegratedMeterService: a transport failure does not throw, does not credit and lets the policy act", async () => {
  const service = makeService({
    balanceRaw: 10_000_000n,
    voucherPort: {
      async requestVoucher() {
        throw new VoucherTransportError("POST /vouchers failed in transport: ECONNREFUSED", { retryable: true });
      },
    },
  });

  const res = await service.processTraffic(500_000);
  assert.equal(res.voucher.kind, "unavailable");
  assert.equal(res.actionApplied.kind, "noop");
  assert.equal(res.meterStatus.paidQuotaBytes, 0);
});

test("IntegratedMeterService: a voucher signed for less than the requested total does not credit", async () => {
  const inner = createInMemoryVoucherPort({ depositRaw: 10_000_000n });
  const signedLow = await inner.requestVoucher({
    version: 1,
    sessionId: "sess_v",
    channel: CHANNEL,
    network: "monad:testnet",
    asset: "USDC",
    cumulativeBytes: 100,
    cumulativeAmount: "100",
    meterReadingId: "mr_low",
    observedAt: "2026-09-23T12:00:00.000Z",
  });
  const service = makeService({
    balanceRaw: 10_000_000n,
    voucherPort: { requestVoucher: async () => signedLow },
  });

  const res = await service.processTraffic(500_000);
  assert.equal(res.voucher.kind, "unavailable");
  assert.equal(res.meterStatus.paidQuotaBytes, 0);
});

test("IntegratedMeterService: rejects misaligned prices between the policy (MB) and the agent (MiB)", () => {
  const session = createConnectivitySession({
    id: "sess_1",
    userId: "user_1",
    channelId: CHANNEL,
    iccid: "89551...",
  });
  const provider: ConnectivityProvider = {
    async provisionEsim() {
      throw new Error("not reached");
    },
    async topUp() {},
    async suspend() {},
    async resume() {},
    async refundUnused() {},
    async terminate() {},
    async getUsage() {
      return ACTIVE_USAGE;
    },
  };

  // PRICE_PER_MIB_RAW loaded with the per-MB number: the typical mistake.
  assert.throws(
    () =>
      new IntegratedMeterService({
        session,
        provider,
        balancePort: { async getChannelBalance() { return 10_000_000n; } },
        pricePerMbRaw: 1_000_000n,
        ...voucherOptions(10_000_000n),
        voucherPricePerMibRaw: 1_000_000n,
        logger: () => {},
      }),
    /misaligned prices.*expected voucherPricePerMibRaw=1048576/,
  );
});