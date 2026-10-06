import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openResellerFundingGate } from "./ResellerFundingGate.ts";

test("the funding halt survives a restart and clears when the balance is restored", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "funding-gate-")), "halt.json");
  const gate = openResellerFundingGate(file);
  assert.equal(gate.isHalted(), false);
  assert.equal(fs.existsSync(file), false);

  gate.halt({ reason: "balance.auto_refill_failed", eventId: "evt-fail", at: "2026-10-06T12:00:00.000Z" });
  const reopened = openResellerFundingGate(file);
  assert.equal(reopened.isHalted(), true);
  assert.equal(reopened.snapshot().eventId, "evt-fail");
  assert.equal(reopened.snapshot().reason, "balance.auto_refill_failed");

  reopened.resume({ eventId: "evt-ok", at: "2026-10-06T12:05:00.000Z" });
  const cleared = openResellerFundingGate(file);
  assert.equal(cleared.isHalted(), false);
  assert.equal(cleared.snapshot().eventId, "evt-ok");
});

test("an unreadable halt file keeps funding paused", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "funding-gate-")), "halt.json");
  fs.writeFileSync(file, "{");
  const lines: Record<string, unknown>[] = [];
  const gate = openResellerFundingGate(file, (line) => lines.push(line));
  assert.equal(gate.isHalted(), true);
  assert.equal(gate.snapshot().reason, "halt_file_unreadable");
  assert.equal(lines.some((line) => line.level === "error"), true);
});
