# Fund-flow architecture: what Citrus allows and what the options are

**Date:** 2026-10-07 · **Status:** analysis and options. The escrow with meter-key vouchers, checkpoints and claims is in `main` and on devnet; the rest of this document is not built, except where it says so.

It follows [`automatizar-flujo-fondos-citrus-bridge.md`](automatizar-flujo-fondos-citrus-bridge.md). That decision assumed Citrus refills the reseller balance by itself with the saved card. This document has what Citrus's documentation and dashboard say, the architecture that results, three options for the money, and the comparison with other providers.

## 1. What the reseller balance is

It is the money in dollars loaded into the Citrus account: **one pot for the whole account**. One account manages every eSIM. Two things come out of the pot:

- **$1.75 each time an eSIM is created.** That is spend.
- **What is passed to each eSIM** (`POST /esim/{iccid}/fund`, from $0.01 to $10,000). Each eSIM has its own wallet; the traveler uses data from there, not from the pot. That is a transfer, not spend.

When a trip closes, `POST /esim/{iccid}/defund` returns to the pot what the eSIM did not use (it takes about 15 minutes).

Example with 3 travelers and $100 in the pot:

| Step | Reseller balance | eSIM 1 | eSIM 2 | eSIM 3 |
|---|---|---|---|---|
| Start | $100 | | | |
| 3 eSIMs are created | $94.75 | $0 | $0 | $0 |
| First tranche to each ($2.50) | $87.25 | $2.50 | $2.50 | $2.50 |
| Traveler 1 uses data and gets another tranche | $84.75 | $2.50 | $2.50 | $2.50 |
| Traveler 2 closes having used $1 | $86.25 | $2.50 | $0 | $2.50 |

## 2. What is automatic in Citrus and what is not

Sources: the [full reference](https://citrusmobile.com/llms-full.txt), the [OpenAPI](https://citrusmobile.com/openapi-reseller.yaml) and the auto-refill screen of the dashboard, read on 2026-10-05.

**Automatic, through the API** (what the backend uses):

- Create, enable, pause, throttle and terminate an eSIM.
- Fund an eSIM and recover what it did not use.
- Read each eSIM's balance and spend, the account balance (`GET /wallet/balance`) and the rates.
- Webhook notices: `balance.low` (the balance drops below $5), `balance.depleted` ($0), `balance.topped_up`, `balance.auto_refill_succeeded` and `balance.auto_refill_failed`.
- Limit: 100 requests per minute.

**There is no API to load the reseller balance.** It is loaded from the dashboard, with a card through Stripe, minimum $10.

**Auto-refill** (set in the dashboard):

- You choose a threshold and an amount: "when the balance drops below $X, charge $Y" to the card saved on the first top-up.
- It fires once per crossing, when the balance goes from above the threshold to below it, and once when it is turned on while already below.
- **Only real spend triggers it.** Moving money into the wallet of an eSIM or a group is a transfer and never charges the card. For AstroAm the only real spend is creating an eSIM.
- If the charge fails (card declined, 3DS), it turns itself off. Turning it on again needs a manual top-up first.
- Cap: 10 charges in 24 hours; after that it turns itself off.

**Balance at zero:** eSIMs already funded keep working. New fundings fail, with `402`.

**Shared-balance groups:** they do not work for AstroAm. Inside a group there is no usage per eSIM (`total_data_charged_usd` comes back `null`) and there is a maximum of 10 groups.

**Citrus's MCP server** (`https://citrusmobile.com/api/mcp`) is the same account for an AI agent, with nine tools: four public ones (rates, coverage, cost estimate, docs search) and five that need the key (see the account, list eSIMs, see one, create one and fund it). It does not pause, terminate, or manage groups or webhooks. It does not load balance either.

### Not confirmed

What happens when tranches leave the balance below the threshold (without triggering anything) and an eSIM is created afterwards: that creation may or may not charge the card, because the crossing already happened. A test settles it; it costs $1.75 plus the refill, which stays as balance.

## 3. Architecture with what Citrus allows

There is no direct path between the treasury on Solana and Citrus. The bridge is the card.

```
 ON SOLANA · USDC

 Traveler ──deposit──▶ Escrow ──claim / close──▶ Treasury
    ▲                    │                           │
    └──── the unused ────┘                           │ what is needed
                                                     ▼
 IN DOLLARS · USD                              Bridge / exchange
                                                     │
 eSIM ◀──$2.50 tranches── Reseller balance ◀──charges── Card ◀── Bank
   │                           ▲
   └──── what is left ─────────┘      Backend: watches the balance and alerts
```

What the backend does by itself:

1. The escrow collects in tranches (`claim`) into the treasury. **In `main`.**
2. It creates the eSIM and funds each tranche from the reseller balance, at most one tranche ahead of what the vouchers cover. **In `main`.**
3. At close, it requests the `defund` and what was left returns to the reseller balance. **In `main`.**

What is not built:

4. Reading the Citrus balance and alerting when it drops below a threshold of our own. Citrus's own notice arrives only at $5.
5. Listening to `balance.auto_refill_failed` and alerting.
6. Holding new trips when the balance is low, so no deposit is accepted that cannot be served.

The weak point is the card: one decline turns auto-refill off until someone turns it on by hand.

## 4. Three options for the money

| | A · Today in `main` | B · The escrow earns | C · The treasury earns |
|---|---|---|---|
| Idle money | Earns nothing | Earns in the escrow | Earns in the treasury |
| Traveler's refund | Guaranteed by the program | Depends on the money market | Guaranteed by the program |
| What becomes dollars | Everything collected | Only what is needed | Only Citrus's cost |
| Program changes | None | Large | None |
| Who holds what was collected | The server's key | To define | Multisig with a limit |
| Status | Built | To build, large | To build, small |

**A.** What is collected reaches the server's wallet and, once it adds up to 5 USDC, all of it is sent to Bridge. It also converts the margin, which does not need converting.

**B.** At deposit, the escrow lends the USDC in a money market. At each collection, close or refund it withdraws what is needed. The largest pool earns: the deposits of every active trip. In exchange, the refund stops depending on the program alone: it depends on the money market having liquidity. Who gets the interest is still to decide.

**C.** The escrow stays as it is. What is collected goes to a treasury in a multisig with a spending limit, and earns there. The backend converts only Citrus's cost.

B and C do not exclude each other: the treasury on Solana serves both. The underlying decision is whether the traveler's deposit is lent or stays in the vault.

### Yield

- **Where.** Kamino Lend. Checked on devnet on 2026-10-05: the program `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` is deployed and has at least three reserves whose token is the Circle USDC AstroAm uses (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). A deposit was not tried. Marginfi is not on devnet.
- **How much.** Latest figure found for USDC on Kamino: 3.51% a year (2026-09-13). During 2026 it moved between 4% and 9%.
- **Per trip:** 20 USDC for 7 days earns a little over 1 cent.
- **In total:** a thousand active trips of 20 USDC are 20,000 USDC earning, about $700 a year.

The balance in Citrus and the bank earn nothing. It is little money: $200 at 3.5% is $7 a year. It is not worth shrinking it and risking auto-refill turning off.

## 5. Reorder point

To keep in dollars only what is needed, and the rest earning:

**On the card = the auto-refill amount + (daily spend × days the money takes to arrive) + margin**

Example with assumed numbers: Citrus spends $8 a day, converting USDC and getting it to the card takes 2 days, 3 days of margin, and auto-refill charges $100 at a time. The card needs $100 + $8 × (2 + 3) = $140.

The backend knows the daily spend from what it funds, and each charge to the card from the `balance.auto_refill_succeeded` notice. It does not see the card's balance: it estimates it.

## 6. First months

With little volume, automating the dollar side is not justified.

1. Load $100 to $200 in Citrus from the dashboard. That top-up saves the card.
2. Auto-refill on, with a high threshold (for example $50) and an amount of $100. Tranches lower the balance without triggering it, so a $20 threshold falls short.
3. The backend watches the balance and alerts (points 4 to 6 of section 3).
4. What is collected stays in the treasury on Solana.
5. Once a month, convert by hand the USDC equivalent to what Citrus spent and pay the card. No Bridge yet.

Automate with Bridge when more than about $1,000 a month goes through Citrus, which is also where its volume discounts start.

## 7. Other providers

AstroAm needs three things: charge for real usage, measure per traveler, and return what was not used. Reviewed on 2026-10-05 against each one's public documentation.

| Provider | How it charges | Returns the unused | Fixed cost | Fits |
|---|---|---|---|---|
| **Citrus** | Balance per eSIM, per KB | Yes, back to the balance | $1.75 per eSIM | Yes |
| **Telnyx** | Per MB (IoT) | You pay only what is used | $0.70 per eSIM and $2 a month | Yes, expensive |
| **Soracom** | Per MB (IoT), billed in arrears | You pay only what is used | $0.06 a day or $1.80 a month | Yes, very expensive |
| **esimba.ai** (Keepgo) | Fixed blocks of megabytes | No; on "Lifetime" they stay on the eSIM | Not published | Partly |
| **TelecomsXChange** | Packages (GB and days) | No | $599.99 a year | No |
| **eSIM Go** | Packages | Only from inventory | Minimum top-up of $1,000, per one review | No |
| **Airalo Partner** | Packages | Not found | None | No |
| **Celitech** | Packages by destination and dates | Not confirmed | Prices not public | No |
| **Gigs** | Plans with a subscription | Does not apply | Per subscriber per month | No |

Price per MB of the ones that charge for usage, against what the app shows the traveler today:

| Destination | Soracom (USD) | AstroAm to the traveler (USDC) |
|---|---|---|
| Brazil | 0.50 | 0.0025 |
| Mexico | 0.20 | 0.0027 |
| Japan | 0.20 | 0.0021 |
| Argentina | 0.12 | 0.0026 |
| United States | 0.073 | 0.0013 |
| Spain | 0.02 | 0.0008 |

Telnyx publishes between $0.0125 and $0.078 per MB for the United States; its rate for Brazil was not found. Citrus's rates per country are in [`../go-to-market.md`](../go-to-market.md).

None of them accepts USDC to fund the account or has an API to load balance, in what was found published. eSIM Go has auto top-up that can be set through its API, and Airalo and Soracom offer billing in arrears, but none of the three charges for usage at a traveler's price.

**Conclusion:** stay with Citrus. If a backup were needed, esimba.ai with its plan that does not expire is the one that fits tranches best; its price list would have to be requested.

## 8. Open decisions

1. **Whether the traveler's deposit earns** (option B) or only the treasury (C).
2. **Who gets the interest** if the escrow earns: the traveler, AstroAm, or split.
3. **Test auto-refill** with tranches below the threshold (section 2).
4. **Ask Citrus** for a top-up through the API, or for auto-refill to count fundings (support@citrusmobile.com).
5. **What pays the card** in the first months, and whether a card funded directly with USDC is better.

## Links

- Citrus, full reference: https://citrusmobile.com/llms-full.txt
- Citrus, OpenAPI: https://citrusmobile.com/openapi-reseller.yaml
- Citrus, agent skills: https://citrusmobile.com/.well-known/agent-skills/index.json
- Kamino Lend, deployment: https://www.mintlify.com/kamino-finance/klend/operations/deployment
- USDC yield in 2026: https://eco.com/support/en/articles/15182156-usdc-yield-in-2026-where-to-earn-interest-on-usdc
- TelecomsXChange, API reference: https://www.telecomsxchange.com/downloads/tcxc-api-reference.md
- Telnyx, IoT pricing: https://telnyx.com/pricing/iot-data-plans
- Soracom, fee schedule (August 2026): https://soracom.io/wp-content/uploads/2026/08/fee_schedule.pdf
- esimba.ai, API 1.13: https://cdn.shopify.com/s/files/1/0546/0449/files/API_Documentation_for_eSIMba_1.13.pdf
- eSIM Go: https://docs.esim-go.com/guides/getting_started/
- Airalo Partner: https://blog.partners.airalo.com/blog/what-is-airalo-partner-platform
- Celitech: https://docs.celitech.com/
