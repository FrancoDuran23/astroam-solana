// Server entrypoint (`npm run server`): listens first, so a bad provider
// config never prevents the process from starting.

import "dotenv/config";
import { createConnectivityProvider } from "../providers/connectivity/createConnectivityProvider.ts";
import { CitrusWebhookHandler } from "../services/CitrusWebhookHandler.ts";
import { webhookEventPath, WebhookEventLog } from "../persistence/webhook-event.ts";
import { createPaymentRail } from "../rails/createPaymentRail.ts";
import { bootProductService } from "../product/runtime/product-boot.ts";
import { createEscrowChain, type EscrowChain } from "../solana/EscrowChain.ts";
import { loadMeterSigner, type MeterSigner } from "../solana/meter-signer.ts";
import { FUND_FLOW_INTERVAL_MS_DEFAULT, startFundFlowLoop } from "../jobs/fund-flow.ts";
import { bootTreasury } from "../treasury/config.ts";
import { openResellerFundingGate } from "../services/ResellerFundingGate.ts";
import { createServerApp } from "./app.ts";
import type { CitrusWebhooksRouteOptions } from "./routes/citrus-webhooks.ts";
import path from "node:path";

const env = process.env;
const port = Number(env.PORT) > 0 ? Number(env.PORT) : 8080;
const host = env.HOST?.trim() || "0.0.0.0";
const dataDir = env.DATA_DIR || "./data";
const log = (line: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(line)}\n`);

const rail = createPaymentRail(env);
const network = rail.network;

// Operator key (SOLANA_OPERATOR_KEYPAIR): with it the backend reads deposits
// from the escrow, funds the eSIM in tranches and sends claims and closes. A
// key that cannot be read degrades to "no automation" with a loud error.
let escrowChain: EscrowChain | undefined;
try {
  escrowChain = createEscrowChain(env);
} catch (error) {
  log({
    level: "error",
    msg: "operator key not loaded — the fund flow is NOT automatic",
    detail: error instanceof Error ? error.message : String(error),
  });
}
let meter: MeterSigner | undefined;
try {
  meter = loadMeterSigner(env);
} catch (error) {
  log({
    level: "error",
    msg: "meter key not loaded — usage vouchers cannot be signed",
    detail: error instanceof Error ? error.message : String(error),
  });
}
const productService = bootProductService(env, rail, escrowChain, meter);

// Treasury router: defaults to disabled (fail-closed).
const { router: treasury, mode: treasuryMode, warnings: treasuryWarnings } = bootTreasury(env, { dataDir });
for (const warning of treasuryWarnings) {
  log({ level: "warn", msg: "treasury config", detail: warning });
}
log({ level: "info", msg: "treasury mode", mode: treasuryMode });

// Funding gate: persists to disk so a restart cannot silently resume funding
// while the reseller card is still failing.
const fundingGate = openResellerFundingGate(
  path.join(dataDir, network, "funding-halt.json"),
  log,
);
if (fundingGate.isHalted()) {
  log({ level: "warn", msg: "funding is halted on boot", detail: fundingGate.snapshot() });
}

// Citrus webhooks: mounted when CONNECTIVITY_PROVIDER=citrus and
// CITRUS_WEBHOOK_SECRET are set. Incomplete config degrades to "no webhooks"
// with a loud error instead of preventing the process from starting.
let citrusWebhooks: CitrusWebhooksRouteOptions | undefined;
if (env.CONNECTIVITY_PROVIDER === "citrus" && env.CITRUS_WEBHOOK_SECRET) {
  try {
    const { esimStore } = createConnectivityProvider({
      CONNECTIVITY_PROVIDER: "citrus",
      CITRUS_API_KEY: env.CITRUS_API_KEY,
      CITRUS_BASE_URL: env.CITRUS_BASE_URL,
      CITRUS_WEBHOOK_SECRET: env.CITRUS_WEBHOOK_SECRET,
      PRICE_PER_MB_RAW: BigInt(env.PRICE_PER_MB_RAW || 25000),
      NETWORK: network,
      DATA_DIR: dataDir,
    });
    const handler = new CitrusWebhookHandler({
      log: WebhookEventLog.open(webhookEventPath(dataDir, network)),
      esimStore,
      fundingGate,
      logger: (line) => log(line as Record<string, unknown>),
    });
    citrusWebhooks = { handler, secret: env.CITRUS_WEBHOOK_SECRET };
    log({ level: "info", msg: "citrus webhooks mounted on /citrus/webhooks" });
  } catch (error) {
    log({
      level: "error",
      msg: "citrus webhook config incomplete — /citrus/webhooks NOT mounted",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const app = createServerApp({ productService, ...(citrusWebhooks !== undefined ? { citrusWebhooks } : {}) });

app.listen(port, host, () => {
  log({ level: "info", msg: `astroam server listening on ${host}:${port}`, network });
});

if (escrowChain !== undefined) {
  const intervalMs = Number(env.FUND_FLOW_INTERVAL_MS) > 0 ? Number(env.FUND_FLOW_INTERVAL_MS) : FUND_FLOW_INTERVAL_MS_DEFAULT;
  startFundFlowLoop({
    service: productService,
    treasury,
    getPayeeBalanceAtomic: () => escrowChain.getPayeeBalanceAtomic(),
    logger: log,
  }, intervalMs);
  log({
    level: "info",
    msg: "fund flow is automatic",
    operator: escrowChain.operator,
    intervalMs,
    treasuryMode,
  });
}
