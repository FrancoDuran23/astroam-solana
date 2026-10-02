// Server entrypoint (`npm run server`): listens first, so a bad provider
// config never prevents the process from starting.

import "dotenv/config";
import { createConnectivityProvider } from "../providers/connectivity/createConnectivityProvider.ts";
import { CitrusWebhookHandler } from "../services/CitrusWebhookHandler.ts";
import { webhookEventPath, WebhookEventLog } from "../persistence/webhook-event.ts";
import { createPaymentRail } from "../rails/createPaymentRail.ts";
import { bootProductService } from "../product/runtime/product-boot.ts";
import { createServerApp } from "./app.ts";
import type { CitrusWebhooksRouteOptions } from "./routes/citrus-webhooks.ts";

const env = process.env;
const port = Number(env.PORT) > 0 ? Number(env.PORT) : 8080;
const dataDir = env.DATA_DIR || "./data";
const log = (line: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(line)}\n`);

const rail = createPaymentRail(env);
const network = rail.network;
const productService = bootProductService(env, rail);

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

app.listen(port, () => {
  log({ level: "info", msg: `astroam server listening on :${port}`, network });
});
