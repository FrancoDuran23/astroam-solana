# Decision: meter with the provider, without our own gateway

**Date:** 2026-09-24 · **Status:** implemented (migration to Citrus Mobile, PR #9)

**Context.** The original design (see [`docs/citrus-mobile-brief.md`](../citrus-mobile-brief.md)
and [`docs/citrus-mobile-spec.md`](../citrus-mobile-spec.md)), which the
migration to Citrus replaced, measured bytes in our own WireGuard gateway:
all of the traveler's traffic went through a server of ours, like a VPN. That
gateway was never built (`src/meter/demo-meter.ts` simulates it). It would
cost servers in several regions, extra latency, a VPN the traveler has to
turn on, and all of their traffic passing through us.

**Decision.** We are a light reseller: we manage the eSIM through the API,
and the provider does the metering and the cutoff. We keep what is ours: the
on-chain payment channel, the vouchers and the refund.

**Consequences.**

- The meter reads usage from the provider instead of a gateway. This
  replaces the original design's rule "we bill only on the gateway's bytes".
- Citrus reports usage in **USD charged** (`total_data_charged_usd`), not in
  bytes. Bytes are computed as USD charged ÷ the country's rate. The
  precision has to be confirmed with a real account.
- There is a gap of about 10 minutes between usage and the voucher. The risk
  is bounded by the eSIM's prepaid wallet: it never spends more than was
  loaded.
- We trust the provider's numbers. Reconciliation
  (`src/jobs/reconciliation.ts`) no longer compares against the gateway.
- The Citrus API allows 100 requests per minute. With one reading every 10
  minutes that is enough for about 1,000 active eSIMs; beyond that, use
  webhooks (`esim.balance_low`, `esim.balance_depleted`) or groups.
- Citrus has no sandbox: tests are run with real money (minimum top-up
  USD 4).

**Options ruled out.**

- **Full reseller with our own gateway:** the most expensive to build and
  operate, and it makes the traveler's experience worse.
- **Payment system only** (someone else sells the eSIM and integrates our
  channel): the simplest to operate, but it depends on finding partners. It
  stays as a future B2B path, for example with wallets that offer the eSIM
  inside their app.
