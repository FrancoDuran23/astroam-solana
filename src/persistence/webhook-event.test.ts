// Tests for the webhook event log (docs/citrus-mobile-spec.md v2 §7 R10): the
// JSONL that persists an event BEFORE the 200, fsyncs, and rebuilds the dedup
// set (`seen`) + the unprocessed backlog (`unprocessed()`) at boot. Real files,
// never mocked.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebhookEventLog } from "./webhook-event.ts";

function tempLogPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webhook-event-log-")), "events.jsonl");
}

test("record persists the line with fsync BEFORE returning (R10) and the id stays in seen", () => {
  const logPath = tempLogPath();
  const log = WebhookEventLog.open(logPath);
  const record = log.record({
    id: "evt-1",
    event: "esim.defunded",
    createdAt: "2026-09-24T10:00:00.000Z",
    payload: { id: "evt-1" },
    receivedAt: "2026-09-24T10:00:01.000Z",
  });
  assert.equal(record.processedAt, null);
  assert.equal(log.seen("evt-1"), true);
  const onDisk = fs.readFileSync(logPath, "utf8");
  assert.equal(onDisk.includes('"id":"evt-1"'), true);
  assert.equal(onDisk.endsWith("\n"), true);
});

test("dedup survives a restart: an id already seen in a previous session", () => {
  const logPath = tempLogPath();
  const first = WebhookEventLog.open(logPath);
  first.record({ id: "evt-dup", event: "esim.defunded", createdAt: "x", payload: {} });
  const reopened = WebhookEventLog.open(logPath);
  assert.equal(reopened.seen("evt-dup"), true);
  assert.equal(reopened.get("evt-dup")?.event, "esim.defunded");
});

test("unprocessed() returns what is not marked; markProcessed clears it durably", () => {
  const logPath = tempLogPath();
  const log = WebhookEventLog.open(logPath);
  log.record({ id: "evt-a", event: "a", createdAt: "x", payload: {} });
  log.record({ id: "evt-b", event: "b", createdAt: "x", payload: {} });
  assert.deepEqual(log.unprocessed().map((r) => r.id).sort(), ["evt-a", "evt-b"]);

  log.markProcessed("evt-a");
  assert.deepEqual(log.unprocessed().map((r) => r.id), ["evt-b"]);

  // Durability: reopening does not revive the one already processed.
  const reopened = WebhookEventLog.open(logPath);
  assert.deepEqual(reopened.unprocessed().map((r) => r.id), ["evt-b"]);
  assert.equal(reopened.seen("evt-a"), true);
});

test("markProcessed of an unknown id does not crash (safe loop)", () => {
  const logPath = tempLogPath();
  const log = WebhookEventLog.open(logPath);
  log.record({ id: "evt-x", event: "x", createdAt: "x", payload: {} });
  log.markProcessed("evt-inexistente");
  assert.deepEqual(log.unprocessed().map((r) => r.id), ["evt-x"]);
});

test("a corrupt line (crash halfway through an append) is discarded; the valid ones before/after remain", () => {
  const logPath = tempLogPath();
  const log = WebhookEventLog.open(logPath);
  log.record({ id: "evt-1", event: "a", createdAt: "x", payload: {} });
  fs.appendFileSync(logPath, '{ "v": 1, "id": " evt-truncado\n');
  log.record({ id: "evt-2", event: "b", createdAt: "x", payload: {} });

  const reopened = WebhookEventLog.open(logPath);
  assert.equal(reopened.seen("evt-1"), true);
  assert.equal(reopened.seen("evt-2"), true);
  assert.equal(reopened.get(" evt-truncado") , undefined);
});

test("a structurally invalid record (schema) does not enter the dedup", () => {
  const logPath = tempLogPath();
  fs.writeFileSync(logPath, JSON.stringify({ v: 1, id: "x" }) + "\n");
  const log = WebhookEventLog.open(logPath);
  assert.equal(log.seen("x"), false);
});