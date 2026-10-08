# Citrus Mobile: brief for replacing Telnyx

> **Note:** this document was written when the AstroAm base charged on
> Stellar. Today payments go through each chain's payment rail
> (`src/rails/PaymentRail.ts`); everything about Citrus still applies.

Goal: replace Telnyx's connectivity infrastructure with Citrus Mobile in the eSIM + on-chain USDC micropayments app. Implement Citrus behind the `ConnectivityProvider` interface, without tying the Stellar logic to the provider.

## Sources

- Docs in Markdown: https://citrusmobile.com/developer/docs/markdown
- OpenAPI: https://citrusmobile.com/openapi-reseller.yaml
- Recipes with code: https://citrusmobile.com/developer/guides
- Official MCP server (streamable HTTP): `https://citrusmobile.com/api/mcp`
  - Without a key: rates, coverage, cost estimates and docs search.
  - With `Authorization: Bearer rsk_...`: provision, fund, list and inspect eSIMs.
  - Claude Code: `claude mcp add --transport http citrus https://citrusmobile.com/api/mcp --header "Authorization: Bearer rsk_YOUR_KEY"`
- Support: support@citrusmobile.com

## Model

- Prepaid connectivity. Each eSIM has a **wallet in USD**. Usage drains it at each operator's and country's rate per MB/GB.
- When the wallet reaches $0, the network cuts data by itself. The most a SIM can spend is what was funded into it.
- There are no plans or bundles. One eSIM works in every country.
- Reusing the eSIM across trips avoids paying the $1.75 provisioning fee again.

## Costs

- Free API, no monthly fee.
- **$1.75 per eSIM provisioned.**
- Data at **10% below retail**. Volume discounts from $1k/month.
- Reseller account: minimum top-up of **$10** (dashboard, paid with Stripe).
- Example: Japan from $1.38/GB (KDDI). Rates by country and operator at `GET /rates`.

## API v2

- Base: `https://citrusmobile.com/api/v2/reseller`
- Auth: `Authorization: Bearer rsk_...` (68 characters).
- Rate limit: **100 req/min per key**. Above it, 429 with a `Retry-After` header.

| Action | Endpoint |
|---|---|
| Provision | `POST /esim/provision` (optional: `end_user_reference`, `label`, `group_id`) |
| Fund | `POST /esim/{iccid}/fund` with `{amount}` (USD, 0.01 to 10000) |
| Detail / list | `GET /esim/{iccid}`, `GET /esim/list?status=&limit=&offset=` |
| Pause / resume | `POST /esim/{iccid}/disable`, `POST /esim/{iccid}/enable` |
| Return unused balance | `POST /esim/{iccid}/defund` |
| Terminate | `POST /esim/{iccid}/terminate` |
| Limit speed | `POST /esim/{iccid}/throttle` with `{speed}` (`NO_LIMIT`, `SPEED_100_KBPS` … `SPEED_5000_KBPS`) |
| Account | `GET /wallet/balance`, `GET /account`, `GET /rates?country=&continent=` |
| Webhooks | `GET/POST /webhooks`, `GET/PUT/DELETE /webhooks/{id}`, `POST /webhooks/{id}/test` |
| Groups (shared balance) | `/groups` and subroutes |

### `POST /esim/provision`

- Returns: `id`, `iccid`, `lpa_string`, `qr_code` (base64 PNG as a data URL), `direct_install_url` (iOS 17.4+, one tap), `status`, `euicc_state`, `group_id`, `cost`, `balance_remaining`, `created_at`.
- The SIM is created with a **$0 wallet**. Without `fund` it passes no data.
- Delivering the QR or the install link to the user is the app's job.

### `GET /esim/{iccid}`

- `wallet_balance_usd`: remaining wallet balance.
- `total_data_charged_usd`: cumulative usage in USD at the `/rates` rates.
- `status`: `pending | active | suspended | terminated`.
- `euicc_state`: `RELEASED | DOWNLOADED | INSTALLED | ENABLED`.

### Errors

`INVALID_API_KEY` (401), `INSUFFICIENT_BALANCE` (402), `ESIM_NOT_FOUND` (404), `ESIM_ALREADY_TERMINATED` (400), `VALIDATION_ERROR` (400), `NO_ESIMS_AVAILABLE` (503, retry), `ESIM_IN_GROUP`, `DEFUND_ALREADY_PENDING` (409), `NO_BALANCE_TO_RETURN` (400), `WALLET_NOT_READY` (400), `RATE_LIMITED` (429).

## Webhooks

- HTTPS URL. At most 5 per account. They turn themselves off after 10 consecutive failures.
- The `signing_secret` (`whsec_...`) is returned **only once**, when the webhook is registered. Save it.
- Verification: HMAC-SHA256 of the **raw body** with the `signing_secret`, compared against the `X-Citrus-Signature` header.
- Envelope: `{ id, event, created_at, data }`.
- Subscribe to specific events or to `["*"]`.
- No timestamp or replay protection is documented. Deduplicate by the event `id`.

| Event | When |
|---|---|
| `esim.provisioned` | The eSIM was provisioned |
| `esim.activated` | The user installed it and it started |
| `esim.balance_low` | The wallet crossed **$5** (fixed threshold, once) |
| `esim.balance_depleted` | The wallet reached $0 and the network cut data |
| `esim.defunded` | The balance was returned (`returned_usd`) |
| `esim.data_suspended`, `esim.data_resumed`, `esim.terminated` | State changes |
| `balance.low`, `balance.depleted`, `balance.topped_up`, `balance.auto_refill_succeeded`, `balance.auto_refill_failed` | Reseller account balance |
| `group.*`, `esim.group_assigned`, `esim.group_removed` | Shared-balance groups |

## Details that break integrations

1. **Reporting delay of about 10 to 15 min.** `fund` answers at once and the user can already use data. But `total_data_charged_usd` and the balance events pause for about 15 min after each fund. Usage is still counted and shows up in the next cycle.
2. **`wallet_balance_usd` rounds down**, up to about 5¢ below the real balance. Funding $20 shows $19.99. Amounts such as $9, $18 and $27 come out exact.
3. **There is no usage endpoint in bytes.** Usage arrives only in USD. Converting to bytes means dividing by the operator's rate from `/rates`, and it is approximate. This affects reconciliation between our own gateway's bytes and the carrier's usage.
4. **`defund` is asynchronous.** It returns 202, pauses data and credits the **reseller account**, not the end user, in about 15 min. During that time the SIM cannot be funded or reactivated. The final amount can be lower than `estimated_return_usd` if there was usage. The refund to the user is settled in the on-chain payment channel.
5. **`terminate` is irreversible and loses the remaining balance.** Run `defund` first.
6. **Groups do not work for per-user billing.** A SIM in a group has no wallet of its own (`wallet_balance_usd` and `total_data_charged_usd` come back `null`). Use one standalone eSIM per user.
7. **`esim.balance_low` is fixed at $5** and cannot be configured. With the 10 to 15 min delay, the top-up policy needs a cushion.

## Mapping to `ConnectivityProvider`

| Interface method | Citrus |
|---|---|
| `provisionEsim` | `POST /esim/provision` |
| `topUp` | `POST /esim/{iccid}/fund` |
| `getUsage` / `getBalance` | `GET /esim/{iccid}` (`total_data_charged_usd`, `wallet_balance_usd`) |
| `suspend` / `resume` | `disable` / `enable` |
| `refundUnused` | `defund` |
| `terminate` | `terminate` |
| Cutoff on balance | `esim.balance_depleted` event |

Flow: the gateway measures bytes, billing prices them, the voucher is signed over the payment channel and the operator funds the SIM in tranches in advance. The float is covered by the reseller account balance.

## Not verified

- The partner page promises a sandbox, but the OpenAPI lists only the production server. Each provision there costs a real $1.75. Confirm in the dashboard how to reach the sandbox before running tests.
- Citrus's pages say "200+" and "220" destinations inconsistently.
- The price was not compared against Telnyx.
- There is no SLA or per-country coverage detail outside `/rates`. New provider: check `/rates` for the countries you need.
