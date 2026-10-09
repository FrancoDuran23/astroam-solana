# Spec v2: replace Telnyx with Citrus Mobile (AstroAm)

> **Note:** this document was written when the AstroAm base charged on
> Stellar. Today payments go through each chain's payment rail
> (`src/rails/PaymentRail.ts`); everything about Citrus still applies.

This document is the **single source** for the migration. It replaces spec v1 (`docs/citrus-mobile-spec.md`) and the plan derived from it. If something conflicts with the README, the README's section "Decision: meter with the provider, without our own gateway" wins, except where this document makes it more precise (marked **[precision]**).

Technical reference for the Citrus API: `citrus-mobile-brief.md`. This spec defines **what to build and when it is done**; the brief explains how Citrus works.

---

## 1. Goal

All of AstroAm's connectivity (eSIM provisioning, funding its wallet, reading usage, cutoff, return of balance) runs on **Citrus Mobile**, feeding the voucher flow of the payment channel that already exists, and Telnyx is removed.

## 2. Decisions in force

| # | Decision | Origin |
|---|---|---|
| D1 | There is no gateway of our own. Citrus does the metering and the cutoff. | README |
| D2 | Usage is read from Citrus (`total_data_charged_usd`) about every 10 min and feeds the meter. | README |
| D3 | The `ConnectivityProvider` interface is replaced by the Citrus shape. Telnyx and Citrus do not coexist. | Decided |
| D4 | `setDataLimit` is removed. The cap is the eSIM's prepaid wallet. | Decided |
| D5 | Conditional wiring by `CONNECTIVITY_PROVIDER` in `server/main.ts`. Without the variable, current behavior does not change. | Decided |
| D6 | File-based persistence (JSON/JSONL) following the repo's pattern. No SQL. | Decided |
| D7 | The voucher agent, its guardrails and the payment channel logic **are not touched**. | Constraint |
| D8 | There is one eSIM per user and it is reused across trips. It is not terminated when a trip closes. | README |

## 3. Scope

**In:** `CitrusProvider`/`CitrusClient`, factory and selector, adapting the meter and the `PolicyEnforcer`, close sequence, eSIM persistence, minimal webhooks, zod config, tests, demos and the removal of Telnyx.

**Out (do not touch):** `src/agent/*` (including `guardrails.ts`), the charging server and channel (`src/server/channel-*`, `close-monitor`), the chain code, the deposit payment, `settle`. Citrus's shared-balance groups (`/groups`) are not used either: a SIM in a group has no wallet or usage of its own.

## 4. Current state (migration fully implemented)

State at the migration commit: **T1–T8 and T10 are implemented and green** (`npm run check`, `npm test`). What follows in this section is the state of the repo at that commit.

The eSIM has since been tested with the real provider (Citrus) and works. Citrus is called when `CONNECTIVITY_PROVIDER=citrus`. `CONNECTIVITY_PROVIDER` still defaults to `fake` for tests and for a public demo, because each real provision costs about 1.75 USD. That default is a deployment choice. Amounts, ICCIDs, and a date for that test are not recorded here.

- `ConnectivityProvider` with the new Citrus shape (R2): `provisionEsim | topUp | getUsage → SimUsage{chargedMicroUsd, walletMicroUsd, status, asOf} | suspend | resume | refundUnused | terminate`. `simCardId === iccid`; there is no `purchaseEsim`, `enable`, `disable` or `setDataLimit`. `FakeProvider` implements the same interface for tests and demos.
- `createConnectivityProvider()` (R1) resolves by `CONNECTIVITY_PROVIDER=fake|citrus` (default `fake`). `CitrusProvider` + `CitrusClient` (axios, configurable base URL, token bucket ≤ 100 req/min, retries with `withRetry`) and the `CitrusApiError` / `CitrusRateLimitedError` / `CitrusResellerBalanceError` taxonomy (`src/shared/citrus-errors.ts`).
- `PolicyEnforcer` (R8): actions `suspend | noop` with `PRICE_PER_MB_RAW` as a dependency (removed: `set_data_limit`, the low threshold and the direct read of `process.env`). `decidePolicy({balanceRaw, costRaw, pricePerMbRaw})` suspends if the balance reaches 0 or does not cover 1 equivalent MB.
- `IntegratedMeterService.processCumulative(cumulativeBytes)` (R7) reuses `requestVoucher → creditIfSigned → decidePolicy`; `processTraffic` is kept for the demos. `arePricesAligned` and `pricePerMibFromPerMbRaw` stay (`src/shared/money.ts`).
- `FundingService` (R5): funds the gap up to the ceiling `maxWalletCents` (I2, `src/shared/usage-math.ts`); persists `pendingFund` before `POST /fund` and reconciles against the wallet after a timeout or crash; a definitive rejection (400/401/404/409) clears the durable intent and rethrows.
- `SessionCloser` (R9): `refundUnused → wait for esim.defunded (webhook or timeout) → final usage → last voucher → channel closed → idle`; `terminate` only with a 0 wallet and no pending `defund` (local rejection `CitrusTerminateWithBalanceError`).
- `CitrusWebhookHandler` + `POST /citrus/webhooks` with `express.raw({ type: "application/json" })` (R10): HMAC-SHA256 verification of the **raw body** with `CITRUS_WEBHOOK_SECRET` against `X-Citrus-Signature` (hex or `sha256=`), in constant time; 401 if invalid. JSONL persistence before answering 200, dedup by `id`, reprocessing of unprocessed events at startup. Handles `esim.defunded` and `esim.balance_depleted`; the rest is logged and answered 200.
- File-based persistence (R11): `src/persistence/esim-record.ts` (map `iccid → {userRef, channelId, status, fundedMicroUsd, pendingFund, chargedBaselineMicroUsd, defundPending, createdAt}`) and `src/persistence/webhook-event.ts` (append-only JSONL, durable dedup).
- zod config (R12): `CONNECTIVITY_PROVIDER`, `CITRUS_API_KEY`, `CITRUS_BASE_URL`, `CITRUS_WEBHOOK_SECRET`, `CITRUS_REQUEST_TIMEOUT_MS`, `PRICE_PER_MB_RAW` (renamed from `TELNYX_PRICE_PER_MB_USDC`), `MARKUP_BPS=15000`, `USDC_USD_RATE_BPS=10000`, `USAGE_POLL_INTERVAL_MS=600000`, `CITRUS_UNPAID_CAP_BPS=1000`, `CITRUS_DEFUND_STABLE_WINDOW_MS=300000`, `CITRUS_DEFUND_TIMEOUT_MS=3600000`. With `citrus`, `PRICE_PER_MB_RAW` is required and the superRefine validates `arePricesAligned` with `PRICE_PER_MIB_RAW`. `.env.example` already has the Citrus section.
- `ConnectivitySession` (R13): `provider: "citrus"`, `chargedMicroUsd`, `chargedBaselineMicroUsd`, `fundedMicroUsd`; `carrierBytes` and `simCardId` removed.
- Reconciliation (R13): `src/jobs/reconciliation.ts` compares `charged − baseline` against `funded − walletUsd` (drift = wallet − expected); diagnostic only, it never throws or affects billing. `mbToBytes` removed.
- `server/main.ts` (D5): webhooks mounted only if `CONNECTIVITY_PROVIDER=citrus` + `CITRUS_WEBHOOK_SECRET` + `PRICE_PER_MB_RAW`, inside a try/catch that degrades with a log without preventing `listen` (FC-R1). The usage loop and `FundingService` are not mounted in the HTTP lifecycle: metering and funding are governed by the existing routes (close) and by manual operation; the value integration (R5/R6/R9) is left for T9.
- Demos (R14): the in-repo demos run without a network using `FakeProvider` and the new interface. A run with `CONNECTIVITY_PROVIDER=citrus` calls Citrus. That path has been tested and works.
- R15: removed `src/providers/connectivity/TelnyxProvider.ts`, `TelnyxProvider.test.ts` and `docs/telnyx-wireless-integracion.md`; removed the `TELNYX_*` vars; README updated ("Missing" checklist, Provider section, documentation).
- Stack: Node ≥22.18 running `.ts` directly, strict ESM TypeScript, tests with `node:test`. Commands: `npm run check`, `npm test` (451 tests green).

## 5. Citrus constraints

- **C1.** Prepaid in USD. Each eSIM has its own wallet; at $0 the network cuts data.
- **C2.** No bytes endpoint. Usage arrives in USD: `total_data_charged_usd` is **cumulative over the SIM's lifetime** (not per trip).
- **C3.** Delay of about 10 to 15 min in usage and balance. After each `fund`, reporting pauses for about 15 min.
- **C4.** `defund` is asynchronous: it answers 202, pauses data at once and credits the reseller account in about 15 min (`esim.defunded`). While it lasts that SIM cannot be `fund`ed or `enable`d. It does not terminate the SIM.
- **C5.** `wallet_balance_usd` rounds down by up to about 5¢. The amount `defund` returns is the displayed balance.
- **C6.** Rate limit of 100 req/min per key. No documented idempotency keys.
- **C7.** No sandbox (README): tests use real money.
- **C8.** `terminate` is irreversible and loses the remaining balance.

## 6. Billing model

Citrus charges the reseller the retail rate −10%. The traveler is charged retail × 1.35. Therefore **the traveler pays 1.5 times what Citrus deducts from the wallet** (`MARKUP = 1.5`; margin ≈ 33%).

### 6.1 Definitions (all in `bigint` integers, no `float`)

- `chargedMicroUsd`: `total_data_charged_usd` converted to micro-USD at the provider boundary.
- `chargedBaselineMicroUsd`: the reading of `total_data_charged_usd` when the channel opens. Trip usage: `chargedSession = charged − baseline` (never decreasing).
- `MARKUP_BPS = 15000`, `USDC_USD_RATE_BPS = 10000` (1 USDC = 1 USD, see §12).
- `PRICE_PER_MB_RAW` (renamed from `TELNYX_PRICE_PER_MB_USDC`) and `PRICE_PER_MIB_RAW`, aligned as today.

### 6.2 Equivalent bytes **[precision]**

The README says "bytes = USD charged ÷ the country's rate". It is implemented by deriving the conversion from the price itself and the markup, with no per-country table:

```
equivalentBytes = floor( chargedSessionMicroUsd × MARKUP_BPS × 10_000_000
                         / (USDC_USD_RATE_BPS × PRICE_PER_MB_RAW) )
```

With that formula, `equivalentBytes × PRICE_PER_MB_RAW` gives exactly `chargedSession × MARKUP` in USDC, so **the charge follows what Citrus deducts, whatever the country or operator**. The "bytes" are a unit of account for the voucher agent; they only resemble real bytes in the country whose rate is `PRICE_PER_MB_RAW`. The UI should show USDC spent, not MB.

Example (Brazil, `PRICE_PER_MB_RAW = 25000`): usage of $3.60 → 2 160 000 000 equivalent bytes → 2160 MB × 25000 = 54 000 000 raw = **5.4 USDC = 3.60 × 1.5**.

### 6.3 Invariants

- **I1 (billing).** The voucher's cumulative amount for `equivalentBytes` is ≈ `chargedSession × MARKUP` (± the `ceil` rounding per MiB, ≤ 0.01%).
- **I2 (wallet cap).** The sum funded to the eSIM on the trip does not exceed:
  ```
  maxWalletCents = floor( depositRaw × USDC_USD_RATE_BPS / (100_000 × MARKUP_BPS) )
  ```
  Example: a 5 USDC deposit (50 000 000 raw) → 333 cents ($3.33). With I1 and I2, the traveler can never use more than was deposited and the channel is not overdrawn.

## 7. Requirements

Each one has an acceptance criterion (AC).

**R1. Selector and factory.** `createConnectivityProvider()` resolves by `CONNECTIVITY_PROVIDER` (`fake | citrus`, **default `fake`**). It fails fast with an actionable message if Citrus config is missing.
- AC: without the variable, server, tests and demos behave as today; with `citrus` and no `CITRUS_API_KEY`, startup fails naming the variable.

**R2. New interface.** It replaces the current one; `setDataLimit` goes away.
```ts
type EsimRecord = { iccid: string; lpaString: string; qrCode: string; directInstallUrl: string; status: string };
type SimUsage   = { chargedMicroUsd: bigint; walletMicroUsd: bigint; status: string; asOf: string };
interface ConnectivityProvider {
  provisionEsim(userRef: string, label?: string): Promise<EsimRecord>;
  topUp(iccid: string, amountCents: number): Promise<void>;
  getUsage(iccid: string): Promise<SimUsage>;
  suspend(iccid: string): Promise<void>;
  resume(iccid: string): Promise<void>;
  refundUnused(iccid: string): Promise<void>;   // defund
  terminate(iccid: string): Promise<void>;
}
```
`simCardId === iccid`. A `FakeProvider` implements the same interface for tests and demos.
- AC: `npm run check` green; no file references `setDataLimit`, `purchaseEsim` or the provider's `mb`.

**R3. `CitrusClient`.** A thin HTTP client (reuse the `HttpClient` pattern from `TelnyxProvider`): configurable base URL, `Authorization: Bearer rsk_…`, rate limiter (budget ≤ 80 req/min), retries with `withRetry`.

| Code | Behavior |
|---|---|
| 429 | Retry honoring `Retry-After` |
| 502, 503 (`NO_ESIMS_AVAILABLE`) | Retry with backoff and a cap |
| 400, 401, 404, 409 | Do not retry; domain error |
| 402 `INSUFFICIENT_BALANCE` | `CitrusResellerBalanceError` (operational alert, not a user error) |
| Timeout on `fund` | Do not retry blindly (see R5) |

- AC: table-driven test of the codes with mocked responses; the key never appears in logs.

**R4. Idempotent provisioning.** `provisionEsim(userRef)` calls `POST /esim/provision` with `end_user_reference=userRef`. If the user already has an eSIM whose state is not `terminated`, it reuses it. A lock per `userRef` (`createChannelMutex` with key `esim:${userRef}`) prevents duplicate concurrent provisions.
- AC: two simultaneous calls with the same `userRef` produce one eSIM and one provisioning charge.

**R5. Funding the wallet.** It is funded **once when the channel opens** and **again if the channel receives a top-up**, with no tranche funding. The amount is the gap up to `maxWalletCents` (I2) minus what was already funded on the trip, in whole cents. Before `POST /fund`, `pendingFund` is persisted; after the response it is confirmed. After a timeout or a crash, it is reconciled with `GET /esim/{iccid}` by comparing `wallet_balance_usd` against the previous value, instead of retrying.
- AC: wallet funded × MARKUP ≤ deposit in every test case; a simulated timeout does not double the funding; a crash between `pendingFund` and the response is resolved on restart.

**R6. Reading usage.** A loop reads `getUsage(iccid)` every `USAGE_POLL_INTERVAL_MS` (default 600 000; minimum 60 000; the data does not get better below about 5 min). It keeps `chargedBaselineMicroUsd` (saved when the channel opens; see R9 on when to read it) and computes `equivalentBytes` with §6.2, monotonically (`max` with the previous reading).
- AC: with mocked readings, `equivalentBytes` matches the formula in the §6.2 example; a reading lower than the previous one does not reduce the cumulative total.

**R7. Vouchers.** The meter receives cumulative `equivalentBytes` and requests the voucher through the current flow (`requestVoucher` → `POST /vouchers`). An idempotent method is added to `IntegratedMeterService` (for example `processCumulative(cumulativeBytes)`) that reuses `requestVoucher`, `creditIfSigned` and `decidePolicy`; `processTraffic` is kept for the demos. **The agent and `PRICE_PER_MIB_RAW` are not modified.** `arePricesAligned` stays.
- AC: a voucher for `equivalentBytes` is accepted by the real agent in a local integration test; quota is credited only with a signed voucher.

**R8. Cutoff.** `PolicyEnforcer` drops the `set_data_limit` action and the low threshold. If the channel's remaining balance reaches 0 (or does not cover 1 equivalent MB), or the agent rejects a voucher in a non-retryable way (`channel_exhausted`, `channel_closing`), `suspend()` is called. **Never noop.** It is a backstop: the natural cutoff is the wallet (I2).
- AC: regression test: a channel with no balance → `suspend` called; the cost basis uses the same `equivalentBytes` as the voucher.

**R9. Closing the trip.** A sequence in a new component (for example `SessionCloser`) that uses the server's existing close port, without modifying it:
1. `refundUnused(iccid)` (`defund`): pauses data, `defund_pending` blocks `topUp`/`resume`.
2. Wait for `esim.defunded` (or backup polling with a timeout; see §12).
3. Final usage = `charged` read **after** settlement − `baseline`. Cross-check: `funded − returned_usd` (tolerance ≤ 5¢ for rounding, C5). If they differ by more, alert and use the lower.
4. Request the last voucher for the final usage; the server collects and the rest returns to the traveler (existing flow).
5. The eSIM stays `idle` and installed (D8). `terminate` is allowed only with a 0 wallet and no pending `defund`, and is not part of the normal flow.
- AC: in a test with `FakeProvider` and a simulated delay, the last voucher reflects the usage after settlement; `terminate` with a balance above 0 is rejected locally.

The `baseline` for the next trip is read just before the first `fund`, with the SIM carrying no traffic and no pending `defund`. Since `defund` pauses data and has already settled, the reading is not stale.

**R10. Webhooks (minimal).** Route `POST /citrus/webhooks` with `express.raw({ type: "application/json" })`, mounted only if `CONNECTIVITY_PROVIDER=citrus`, without affecting other routes (the only change in `app.ts` or `main.ts`). It verifies the HMAC-SHA256 signature of the **raw body** with `CITRUS_WEBHOOK_SECRET` against `X-Citrus-Signature`, in constant time, accepting hex with or without the `sha256=` prefix (Citrus does not document the format). Invalid signature → 401. **Persist the event in the JSONL before answering 200**, then process it; at startup, reprocess the ones not marked `processed_at` and rebuild the dedup set by `id`. Events handled: `esim.defunded` and `esim.balance_depleted`; the rest is recorded and answered 200. The other events (`esim.activated`, `balance.*`, etc.) are deferred.
- AC: an event with a valid signature is processed once even if it arrives twice; with an invalid signature it is rejected; `POST /webhooks/{id}/test` returns 200 against the running server.

**R11. File-based persistence.** `src/persistence/esim-record.ts` (map `iccid → { userRef, channelId, status, fundedMicroUsd, pendingFund, chargedBaselineMicroUsd, defundPending, createdAt }`) and `src/persistence/webhook-event.ts` (append-only JSONL). Atomic writes with the pattern from `channel-record.ts`; writes to the map serialized with `createChannelMutex`.
- AC: two concurrent writes to the same record lose no data; a restart keeps the dedup.

**R12. zod configuration.** In `src/config/env.ts` (`sharedSchema`), reusing `rawPositiveIntegerRaw()`:

| Variable | Notes |
|---|---|
| `CONNECTIVITY_PROVIDER` | `fake \| citrus`, default `fake` |
| `CITRUS_API_KEY` | prefix `rsk_`; required only with `citrus` |
| `CITRUS_BASE_URL` | default `https://citrusmobile.com/api/v2/reseller` |
| `CITRUS_WEBHOOK_SECRET` | prefix `whsec_`; required only if webhooks are mounted |
| `PRICE_PER_MB_RAW` | renamed from `TELNYX_PRICE_PER_MB_USDC`; same meaning and alignment with `PRICE_PER_MIB_RAW` |
| `MARKUP_BPS` | default 15000 |
| `USDC_USD_RATE_BPS` | default 10000 |
| `USAGE_POLL_INTERVAL_MS` | default 600000; min 60000 |

`.env.example` replaces the Telnyx section with Citrus, with no real values. Update messages and comments that name Telnyx.
- AC: `grep -ri "TELNYX_PRICE_PER_MB_USDC"` is empty; invalid values fail at startup naming the variable.

**R13. Reconciliation reused.** `src/jobs/reconciliation.ts` stops comparing against the gateway and compares two Citrus figures instead: `charged − baseline` against `funded − walletUsd`. Diagnostic only: it records the difference (tolerance ≥ 5¢ + lag), and never throws or affects billing. `ConnectivitySession` becomes `provider: "citrus"`, drops `carrierBytes` and adds `chargedMicroUsd`, `chargedBaselineMicroUsd`, `fundedMicroUsd`.
- AC: with mocked readings the job logs the difference and does not throw on provider errors.

**R14. Tests and demos.** Contract tests with fixtures from the OpenAPI; error table; timeout on `fund`; invariants I1 and I2; `PolicyEnforcer` with `suspend`; close sequence; duplicate webhook and invalid signature; concurrency of `provisionEsim` and of writes. The app can still run without a network using `FakeProvider` and `FakeRail`. That is how tests and a public demo avoid spending about 1.75 USD per provision. `CONNECTIVITY_PROVIDER=citrus` calls Citrus, and that path has been tested and works.
- AC: `npm run check` and `npm test` green.

**R15. Removing Telnyx.** Last commit, **only after the smoke test (T9)**: delete `TelnyxProvider.ts` and its test, `docs/telnyx-wireless-integracion.md`, the `TELNYX_*` variables; update the README ("Missing" checklist and Provider section).
- AC: `grep -ri telnyx` is empty in code and config (it stays in git history).

## 8. Design

**New components:** `providers/connectivity/{CitrusClient,CitrusProvider,FakeProvider,createConnectivityProvider}.ts`, `shared/{token-bucket,citrus-errors}.ts`, `services/{SessionCloser,CitrusWebhookHandler,FundingService}.ts`, `server/routes/citrus-webhooks.ts`, `persistence/{esim-record,webhook-event}.ts`.

**Modified (minimal change):** `ConnectivityProvider.ts`, `ConnectivitySession.ts`, `PolicyEnforcer.ts`, `meter-service.ts`, `reconciliation.ts`, `config/env.ts`, `.env.example`, `server/main.ts` (a single registration call), `scripts/demo-*.ts`.

**Flow of a trip**

1. **Open.** USDC deposit → payment channel open → `provisionEsim` (or reuse) → read `baseline` → `topUp` to `maxWalletCents` (I2) → hand the QR / `directInstallUrl` to the traveler.
2. **Metering (about every 10 min).** `getUsage` → `chargedSession` → `equivalentBytes` → signed voucher → quota credited → `PolicyEnforcer` evaluates.
3. **Channel top-up.** New gap up to the new `maxWalletCents` → `topUp` for the difference.
4. **Close.** R9.

**Internal eSIM states:** `provisioned → active → (cut) → defund_pending → idle → active …`; `terminated` only by an explicit operation.

## 9. Task plan

| # | Task | Depends on | Done when | Status |
|---|---|---|---|---|
| T1 | New interface + `FakeProvider`; adapt consumers and demos (R2, part of R14) | — | `npm run check` and demos green | ✓ done |
| T2 | zod config and selector (R1, R12) | T1 | AC of R1 and R12 | ✓ done |
| T3 | `CitrusClient` and `CitrusProvider` (R3, R4) | T1 | Contract and error tests | ✓ done |
| T4 | `esim` and `webhook-event` persistence (R11) | T1 | AC of R11 | ✓ done |
| T5 | Equivalent bytes, `processCumulative`, reading loop (R6, R7) | T1, T4 | AC of R6, R7 | ✓ done (R6 to validate in T9) |
| T6 | `FundingService` (R5) and `PolicyEnforcer` without `set_data_limit` (R8) | T3, T4, T5 | AC of R5, R8 | ✓ done |
| T7 | `SessionCloser` (R9) and reconciliation reused (R13) | T5, T6 | AC of R9, R13 | ✓ done |
| T8 | Minimal webhooks (R10) | T4, T7 | AC of R10 | ✓ done |
| T9 | Real run with Citrus (§10) | T2 to T8 | End-to-end run with Citrus | Tested with Citrus; it works. Amounts, ICCIDs, and a date are not recorded here. |
| T10 | Remove Telnyx and update docs (R15) | T9 | AC of R15 | ✓ done |

## 10. Smoke test (T9)

The eSIM has been tested end to end with the real provider (Citrus) and works. The measurements this section originally asked for are not written down here: a specific fund amount, the precision of `total_data_charged_usd`, the webhook signature format, and the comparison of `charged − baseline` against `funded − returned`.

## 11. Implementation notes

- Treat `wallet_balance_usd` as "at least" that balance (C5). Funding amounts in whole cents.
- Convert the API's USD to `bigint` micro-USD in one place (the `CitrusProvider` boundary); no `float` further in.
- The key and the secret are never logged; mask `Authorization`.
- One active channel per eSIM at a time.
- Every decision that depends on usage or balance tolerates data up to about 15 min old.

## 12. Open questions and risks

1. **Real costs.** The README says "first eSIM free, USD 2.45 after" and "minimum top-up USD 4"; the reseller API documentation says **$1.75 per eSIM** and **$10 minimum top-up**. Confirm in the dashboard before budgeting T9.
2. **Precision of `total_data_charged_usd`** (the README already asks to confirm it): cents, or down to the KB. Validated in T9.
3. **End of the `defund` without a webhook.** The API documents no indicator of a pending `defund` in `GET /esim/{iccid}`. Define the backup polling (wallet at 0 and stable usage?) and its timeout in T9.
4. **Format of the webhook signature** (hex, base64 or with a prefix). Covered by R10's tolerant comparison; confirm with `POST /webhooks/{id}/test`.
5. **`USDC_USD_RATE_BPS`.** 1 USDC = 1 USD is assumed. Confirm or quote.
6. **"Equivalent bytes" vs the README's "country rate"** (§6.2): the formula is equivalent in what it charges and avoids maintaining per-country rates. Confirm with the team that real MB do not need to be shown to the traveler.
7. **Close port.** **Resolved:** the `SessionCloser` (R9) uses the charging server's existing close flow (final voucher → channel close) without modifying its port; it orchestrates `refundUnused` + webhook + last voucher from the sessions service.
8. **`NetworkDataMeter`.** **Resolved:** the gateway simulator (`demo-meter.ts`) stays only as the base of `processTraffic` for the demos; in Citrus mode real usage arrives through `getUsage` (§6.2) and the policy is R8 (suspend/noop).
9. **Delay risk (C3).** Mitigated by the prepaid wallet (I2), but a traveler can use up to about 15 min of data before the meter sees it; that is why the wallet cap is the primary protection and the `PolicyEnforcer` only a backstop.
10. **New provider.** No visible SLA; no sandbox. `FakeProvider` stays available for tests and for deploys that should not spend about 1.75 USD per provision. The Citrus path has been tested and works.

## 13. References

- Technical brief: `citrus-mobile-brief.md`
- OpenAPI: https://citrusmobile.com/openapi-reseller.yaml
- Docs in Markdown: https://citrusmobile.com/developer/docs/markdown
- Recipes: https://citrusmobile.com/developer/guides
- Official MCP (rates and docs without a key): `https://citrusmobile.com/api/mcp`
- Public rates: https://citrusmobile.com/rates
- Support: support@citrusmobile.com
