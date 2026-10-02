// Picks the payment rail from PAYMENT_RAIL. "fake" (default) keeps the app,
// tests and demos running with simulated payments; each chain adds its own
// rail here.

import type { PaymentRail } from "./PaymentRail.ts";
import { FakeRail } from "./FakeRail.ts";

export type PaymentRailKind = "fake";

export function createPaymentRail(env: Record<string, string | undefined>): PaymentRail {
  const kind = env.PAYMENT_RAIL ?? "fake";
  if (kind === "fake" || kind === "") return new FakeRail();
  throw new Error(`PAYMENT_RAIL=${kind} is not available yet (supported: fake)`);
}
