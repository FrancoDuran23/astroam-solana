import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServerApp } from "./app.ts";
import { bootProductService } from "../product/runtime/product-boot.ts";
import type { MissionProductService } from "../product/services/MissionProductService.ts";

async function withApp(fn: (baseUrl: string) => Promise<void>, productService?: MissionProductService) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "astroam-app-"));
  const app = createServerApp({ productService: productService ?? bootProductService({ DATA_DIR: dir }) });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /health is always 200", async () => {
  await withApp(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "alive" });
  });
});

test("GET /ready reports the payment rail and mode", async () => {
  await withApp(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/ready`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.status, "ready");
    assert.equal(body.network, "demo:local");
    assert.equal(body.paymentsLive, false);
    assert.equal(body.mode, "demo");
  });
});

test("the mission API is mounted under /api", async () => {
  await withApp(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/capabilities`);
    assert.equal(res.status, 200);
    const caps = (await res.json()) as Record<string, unknown>;
    assert.equal(caps.paymentRail, "Simulated payments");
  });
});

test("an uncaught error answers JSON, never an HTML stack trace", async () => {
  const failing = {
    async getCapabilities() {
      throw new Error("boom");
    },
  } as unknown as MissionProductService;
  await withApp(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/ready`);
    assert.equal(res.status, 500);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, "internal_error");
  }, failing);
});
