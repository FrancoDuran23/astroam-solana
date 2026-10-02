import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeRail, usdcToRaw } from "./FakeRail.ts";
import { buildMessage1 } from "../meter/voucher-port.ts";

async function openChannel(rail: FakeRail, amountUsdc = 5) {
  const intent = await rail.createDepositIntent({ missionId: "mis_1", amountUsdc, purpose: "mission" });
  const confirmed = await rail.confirmDeposit({ missionId: "mis_1", intentId: intent.intentId, txHash: "0xabc", purpose: "mission" });
  assert.equal(confirmed.valid, true);
  return { intent, channelId: (confirmed as { channelId: string }).channelId };
}

function m1(channel: string, cumulativeBytes: number) {
  return buildMessage1({
    sessionId: "ses_1",
    channel,
    network: "demo:local",
    cumulativeBytes,
    pricePerMibRaw: 26_215n,
    meterReadingId: `mr_${cumulativeBytes}`,
    observedAt: new Date("2026-10-01T12:00:00Z"),
  });
}

test("a confirmed deposit opens a channel holding that deposit", async () => {
  const rail = new FakeRail();
  const { intent, channelId } = await openChannel(rail);
  assert.equal(intent.isMock, true);
  assert.match(intent.qr ?? "", /^data:image\/svg\+xml;base64,/);
  assert.equal(await rail.getChannelDepositRaw(channelId), usdcToRaw(5));
});

test("a deposit is rejected for an unknown intent or an empty tx hash", async () => {
  const rail = new FakeRail();
  const unknown = await rail.confirmDeposit({ missionId: "mis_1", intentId: "nope", txHash: "0xabc", purpose: "mission" });
  assert.deepEqual(unknown, { valid: false, reason: "unknown_intent" });
  const intent = await rail.createDepositIntent({ missionId: "mis_1", amountUsdc: 1, purpose: "mission" });
  const empty = await rail.confirmDeposit({ missionId: "mis_1", intentId: intent.intentId, txHash: " ", purpose: "mission" });
  assert.deepEqual(empty, { valid: false, reason: "missing_tx_hash" });
});

test("a top-up adds to the same channel", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const top = await rail.createDepositIntent({ missionId: "mis_1", amountUsdc: 2, purpose: "topup", channelId });
  const res = await rail.confirmDeposit({ missionId: "mis_1", intentId: top.intentId, txHash: "0xdef", purpose: "topup", channelId });
  assert.equal(res.valid && res.depositRaw, usdcToRaw(7));
});

test("closing settles the highest signed voucher and refunds the rest", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const port = rail.voucherPortFor(channelId);
  assert.equal((await port.requestVoucher(m1(channelId, 300_000_000))).status, "signed");
  assert.equal((await port.requestVoucher(m1(channelId, 1_000_000_000))).status, "signed");

  const outcome = await rail.closeChannel(channelId);
  assert.equal(outcome.kind, "closed");
  if (outcome.kind !== "closed") return;
  assert.equal(outcome.settledRaw + outcome.refundedRaw, usdcToRaw(5));
  assert.ok(outcome.settledRaw > 0n);
  assert.equal((await rail.closeChannel(channelId)).kind, "failed");
});

test("closing a channel with no voucher has nothing to settle", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail);
  assert.equal((await rail.closeChannel(channelId)).kind, "nothing_to_close");
});
