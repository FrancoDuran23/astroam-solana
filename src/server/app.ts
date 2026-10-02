// HTTP app: the mission API the frontend uses (/api), health and readiness,
// and Citrus webhooks. Chain specifics live behind the payment rail inside
// the product service, never here.

import express, { type ErrorRequestHandler, type Express } from "express";
import { createCitrusWebhooksRoute, type CitrusWebhooksRouteOptions } from "./routes/citrus-webhooks.ts";
import { createProductRouter } from "../product/api/routes.ts";
import { bootProductService } from "../product/runtime/product-boot.ts";
import type { MissionProductService } from "../product/services/MissionProductService.ts";

export type CreateServerAppOptions = {
  /** Defaults to the service built from the environment (product-boot). */
  productService?: MissionProductService;
  /** Citrus webhooks (docs/citrus-mobile-spec.md v2 §7 R10), mounted only
   * when `CONNECTIVITY_PROVIDER=citrus` and `CITRUS_WEBHOOK_SECRET` are set
   * (see `server/main.ts`). The route registers its own `express.raw` parser
   * BEFORE the app-wide `express.json()`, so it sees the raw body for the
   * HMAC and the rest of the app is unaffected. */
  citrusWebhooks?: CitrusWebhooksRouteOptions;
};

/** Any uncaught error answers JSON; a stack trace never reaches the client. */
const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({
    error: "internal_error",
    message: err instanceof Error ? err.message : String(err),
  });
};

export function createServerApp(options: CreateServerAppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");

  if (options.citrusWebhooks !== undefined) {
    app.post(
      "/citrus/webhooks",
      express.raw({ type: "application/json" }),
      createCitrusWebhooksRoute(options.citrusWebhooks),
    );
  }
  app.use(express.json());

  const productService = options.productService ?? bootProductService(process.env);

  app.get("/health", (_req, res) => {
    res.json({ status: "alive" });
  });

  app.get("/ready", async (_req, res, next) => {
    try {
      const caps = await productService.getCapabilities();
      res.json({
        status: "ready",
        network: caps.network,
        paymentRail: caps.paymentRail,
        paymentsLive: caps.paymentsLive,
        mode: caps.mode,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", createProductRouter(productService));

  // Mounted last so Express's error dispatch picks it up for every route.
  app.use(jsonErrorHandler);

  return app;
}
