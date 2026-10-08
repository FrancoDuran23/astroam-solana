# Go-to-market

**Date:** 2026-10-08 · **Status:** a plan with published costs. Reseller costs below were read on 2026-10-07. Card, roaming, and retail quotes were read on 2026-10-08. No channel has been contacted and nothing has been sold.

## Who buys

### Target market

The first market is Argentine travelers going to a neighboring country: Chile, Brazil, Uruguay, Paraguay, or Bolivia. User and buyer are the same person: the traveler, who already saves in USDC.

We launch with Argentina's neighbors (Chile, Brazil, Uruguay, Paraguay, Bolivia); expansion covers all 220 destinations our eSIM provider supports.

On the cheapest network the traveler pays **2.48 USDC/GB** in Chile, Brazil, and Uruguay, **2.76** in Bolivia, and **5.25** in Paraguay (reseller cost × 1.5, `MARKUP_BPS=15000`). Against the cheapest eSIM paid with an Argentine card in pesos, 30% percepción included, on 8 October 2026:

- Chile, Brazil, and Uruguay: 21% to 68% below the cheapest 1 GB to 5 GB card pack. A 10 GB pack narrows that to 24% in Chile and Uruguay. Brazil at 10 GB is about even (24.80 USDC against US$24.72).
- Bolivia: 39% to 72% below, from a 10 GB pack (39%) to a 1 GB pack (72%).
- Paraguay: 26% below a 1 GB pack. A fully used 5 GB pack is 6% cheaper than AstroAm, and a fully used 10 GB pack is 61% cheaper.

If the traveler uses half the pack, the card price per GB used doubles and AstroAm stays at the same USDC per GB, because the unused escrow is refunded. The table, the caveats, and the sources are under [Price against the card](#price-against-the-card). The same comparison is in the README.

Planned onboarding, not built: ask trip length and a usage profile (maps and messaging, social, or video calls and streaming), estimate the gigabytes, and recommend the cheaper option. Light or uncertain usage goes to pay-per-MB, and unused funds come back to the wallet. Heavy, predictable usage goes to a prepaid block of gigabytes at our eSIM provider's public retail rate, which is lower per GB. That block costs less once the traveler uses about **3.7 GB of a 5 GB block**, or about **7.4 GB of a 10 GB block**. Country by country:

| Destination | 5 GB block, breakeven | 10 GB block, breakeven |
|---|---|---|
| Chile, Brazil, Uruguay | 3.71 GB | 7.42 GB |
| Paraguay | 3.70 GB | 7.41 GB |
| Bolivia | 3.71 GB | 7.43 GB |

`breakeven GB = prepaid GB × (retail US$/GB) / (AstroAm USDC/GB)`, with unused gigabytes on the prepaid block counted as spent. Retail, cheapest network, 8 October 2026: 1.84 in Chile, Brazil, and Uruguay (1.84 / 2.48 = 74.2%), 3.89 in Paraguay (3.89 / 5.25 = 74.1%), 2.05 in Bolivia (2.05 / 2.76 = 74.3%). Worked example: `5 × 1.84 / 2.48 = 3.71`. The full assumptions are under [Smart plan selection](#smart-plan-selection-planned) and in the README. This step is not in the app.

## What we sell, in one line

Travel data you pay in USDC: you deposit once, AstroAm charges only the megabytes you used, and the rest returns to your wallet by itself.

## Price and margin

The rule in the code is one number: the traveler pays what the carrier charged AstroAm, times 1.5 (`MARKUP_BPS=15000`).

Costs are Citrus Mobile's published reseller rates for the cheapest network in each country, read from their public rates tool on 2026-10-07.

| Destination | Cost per GB (USD) | Traveler pays per GB (USDC) | Gross margin per GB |
|---|---|---|---|
| Spain | 0.54 | 0.81 | 0.27 |
| United States | 0.87 | 1.31 | 0.44 |
| Japan | 1.38 | 2.07 | 0.69 |
| Brazil | 1.65 | 2.48 | 0.83 |
| Chile | 1.65 | 2.48 | 0.83 |
| Uruguay | 1.65 | 2.48 | 0.83 |
| Argentina | 1.70 | 2.55 | 0.85 |
| Mexico | 1.80 | 2.70 | 0.90 |
| Bolivia | 1.84 | 2.76 | 0.92 |
| Paraguay | 3.50 | 5.25 | 1.75 |

The rate depends on the network the phone connects to. In Brazil, Vivo is $1.65 per GB, Claro $4.14 and TIM $4.84. The traveler is charged for what was really billed, so the same megabyte costs more on a dearer network.

### The fixed cost

Citrus charges **$1.75 for each eSIM issued**, once. The same eSIM is reused on later trips.

On a traveler's first trip that fee has to be earned back before the trip makes money:

| Destination | Margin per GB | Data needed to cover $1.75 |
|---|---|---|
| Brazil | 0.83 | 2.1 GB |
| United States | 0.44 | 4.0 GB |
| Spain | 0.27 | 6.5 GB |

A short first trip loses money at this price. The options are a one-time activation fee of 1.75 USDC taken from the first deposit, or accepting the loss as the cost of acquiring the traveler. This is not decided.

### Other costs

- **Solana fees.** 0.000065 SOL for a whole session of seven transactions, measured on devnet.
- **USDC to dollars.** Bridge publishes about 0.25%. There is no account yet.
- **Unused data.** Nothing is lost: what the eSIM did not use returns to the reseller balance when the trip closes.

### What we do not know

- What share of a deposit ends up refunded. The devnet run refunded 25% (0.625 of 2.5 USDC); that is a test, not a traveler.
- What it costs to acquire a traveler.
- How many Argentine travelers hold USDC on Solana.

## Price against the card

Same figures as the README. AstroAm's column is the cheapest-network rate above (cost × 1.5). The card column is the cheapest pack of that size among Airalo, Saily, Nomad, Roamless, and Ubigi (Ubigi checked for Brazil), list price × 2,002 / 1,539.01. That is the dólar tarjeta (ARS 2,002 = official + 30% percepción) converted at MEP (ARS 1,539.01), both from Ámbito on 8 October 2026 at 00:06. "Lower" means AstroAm is below that card price.

| Destination | AstroAm (USDC/GB) | Card eSIM, 1 GB (US$/GB) | vs 1 GB | Card eSIM, 5 GB (US$/GB) | vs 5 GB | 5 GB pack, half used (US$ per GB used) | AstroAm, half used (USDC per GB used) | vs half-used 5 GB |
|---|---|---|---|---|---|---|---|---|
| Chile | **2.48** | 5.79 | 57% lower | 3.64 | 32% lower | 7.28 | **2.48** | 66% lower |
| Brazil | **2.48** | 5.14 | 52% lower | 3.12 | 21% lower | 6.24 | **2.48** | 60% lower |
| Uruguay | **2.48** | 7.81 | 68% lower | 4.94 | 50% lower | 9.89 | **2.48** | 75% lower |
| Paraguay | **5.25** | 7.09 | 26% lower | 4.94 | 6% higher | 9.89 | **5.25** | 47% lower |
| Bolivia | **2.76** | 9.69 | 72% lower | 7.02 | 61% lower | 14.05 | **2.76** | 80% lower |

A fully used 10 GB card pack: Chile and Uruguay US$3.25/GB (AstroAm 24% lower), Brazil US$2.47/GB (about the same: 24.80 USDC against US$24.72), Paraguay US$3.25/GB (AstroAm 61% higher), Bolivia US$4.55/GB (AstroAm 39% lower).

| Destination | Cheapest 1 GB pack | Cheapest 5 GB pack | Cheapest 10 GB pack |
|---|---|---|---|
| Chile | Roamless, US$4.45, 30 days | Nomad, US$14, 30 days | Nomad, US$25, 30 days |
| Brazil | Roamless, US$3.95, 30 days | Airalo, US$12, 7 days (Nomad is US$12 for 30 days) | Nomad, US$19, 30 days (Ubigi is the same price) |
| Uruguay | Nomad, US$6, 7 days | Nomad, US$19, 30 days | Nomad, US$25, 30 days |
| Paraguay | Roamless, US$5.45, 30 days | Nomad, US$19, 30 days | Nomad, US$25, 30 days |
| Bolivia | Roamless, US$7.45, 30 days | Airalo, US$27, 7 days | Airalo, US$35, 7 days |

The table is the cheapest network. A dearer network costs more: Brazil Claro 6.21 USDC/GB and TIM 7.26, from the cost table above. Public rates on 8 October 2026, times 1.35, put a dearer network near 6.91 USDC/GB in Chile, 7.26 in Brazil, 8.61 in Uruguay, and 6.22 in Paraguay.

- **A US dollar account** pays the list price, without the 30%. AstroAm is then higher in Brazil at 5 GB (US$2.40/GB) and 10 GB (US$1.90/GB), and in Paraguay from 3 GB up (US$4.67, US$3.80, and US$2.50 per GB). Chile and Uruguay at 10 GB are US$2.50/GB, about the same as 2.48.
- **Personal and Movistar**, at full use: Personal 5 GB / 15 days for Brazil, Paraguay, Uruguay, and Chile is ARS 15,000, US$1.95/GB (legal text valid 21 September 2026 to 20 October 2026). Movistar 3 GB / 7 days, which includes Bolivia, is ARS 10,800, US$2.34/GB (text says 1–31 August 2026 and was still published on 8 October 2026). Two Movistar packs to cover 5 GB in Bolivia are US$2.81 per GB of the 5 GB. Some Personal and Claro postpaid plans include Mercosur and Chile roaming, so the extra data charge is zero. At half use, Personal is US$3.90 per GB used and the Movistar 3 GB pack is US$4.68. AstroAm at 2.48 and Bolivia at 2.76 are below those. Paraguay at 5.25 stays above US$3.90.
- **Our eSIM provider's public retail price**, cheapest network, is 1.84 US$/GB in Chile, Brazil, and Uruguay, 3.89 in Paraguay, and 2.05 in Bolivia. With the 30% percepción that is about 2.39, 5.06, and 2.67, still under AstroAm. The pay-per-MB rate is that retail price times 1.35.

The unused balance is what comes back. Card packs and carrier packs do not return unused data (Airalo, Saily, and Holafly refund a plan that was never activated). AstroAm's close returns the unused escrow to the wallet, so the price per GB used stays flat.

The $1.75 issue fee is not in the per-GB figures. Buying USDC at the crypto rate (ARS 1,605.09) instead of MEP adds about 4.3%, and that is not in the table. VAT on these sellers is not added (they are not on ARCA's list). Impuesto PAIS ended on 23 December 2024.

Traveler interviews, including roaming bills paid with an Argentine card, are in [validation.md](validation.md).

### Smart plan selection (planned)

**Planned. Not implemented.**

The traveler would answer trip length and a usage profile: maps and messaging, social, or video calls and streaming. AstroAm would estimate gigabytes and recommend pay-per-MB escrow (light or uncertain usage; unused funds refund automatically) or a prepaid block at the provider's public retail rate (heavy, predictable usage; lower per GB).

The provider's catalog in this repo is a prepaid balance at a per-GB rate, not a list of named plans (`docs/citrus-mobile-brief.md`). A "fixed bundle" here means G gigabytes prepaid at the public retail rate, with unused gigabytes counted as spent. Pay-per-MB costs the AstroAm rate times gigabytes used, because the refund drops the rest. 1 USDC = 1 USD (`USDC_USD_RATE_BPS=10000`).

The block costs less when use is above `G × retail / AstroAm`.

| Destination | Retail (US$/GB) | AstroAm (USDC/GB) | Share of the block | 5 GB block | 10 GB block |
|---|---|---|---|---|---|
| Chile, Brazil, Uruguay | 1.84 | 2.48 | 74.2% | 3.71 GB | 7.42 GB |
| Paraguay | 3.89 | 5.25 | 74.1% | 3.70 GB | 7.41 GB |
| Bolivia | 2.05 | 2.76 | 74.3% | 3.71 GB | 7.43 GB |

Chile, Brazil, Uruguay, 5 GB: `5 × 1.84 / 2.48 = 3.71`, and `5 × 1.84 = 9.20 = 3.71 × 2.48`. Paraguay: `5 × 3.89 / 5.25 = 3.70`. Bolivia: `5 × 2.05 / 2.76 = 3.71`. The $1.75 issue fee and the 30% percepción are left out of both sides. Per-profile gigabyte estimates are not in the repo, so they are not stated here.

Sources, read on 8 October 2026 unless noted:

- AstroAm USDC/GB: the cost table in this file, read 7 October 2026, times 1.5.
- Exchange rates: [Ámbito, 8 October 2026](https://www.ambito.com/finanzas/dolar-hoy-cuanto-cotiza-este-jueves-8-octubre-n6331412).
- Packs: [Roamless Chile](https://roamless.com/esim/chile-esim), [Nomad Chile](https://www.nomadesim.com/chile-eSIM), [Roamless Brazil](https://roamless.com/esim/brazil-esim), [Airalo Brazil](https://www.airalo.com/brazil-esim), [Nomad Brazil](https://www.nomadesim.com/brazil-eSIM), [Ubigi Brazil](https://cellulardata.ubigi.com/rates-and-coverage/brazil-data-plans/), [Nomad Uruguay](https://www.nomadesim.com/uruguay-eSIM), [Roamless Paraguay](https://roamless.com/esim/paraguay-esim), [Nomad Paraguay](https://www.nomadesim.com/paraguay-eSIM), [Roamless Bolivia](https://roamless.com/esim/bolivia-esim), [Airalo Bolivia](https://www.airalo.com/bolivia-esim). Saily country pages were compared and were higher at these sizes.
- Refund terms: [Airalo](https://airalo.com/legal/terms-of-use), [Saily](https://support.saily.com/hc/en-us/articles/16420576170652-What-is-Saily-s-refund-policy), [Holafly](https://esim.holafly.com/refund-policy/).
- Carriers: [Personal roaming](https://www.personal.com.ar/roaming), [Movistar packs](https://www.movistar.com.ar/legales/roaming/packs-roaming-pospago), [Claro Chile and Uruguay](https://www.claro.com.ar/personas/roaming/terminos-condiciones-chile-uruguay), [Claro Brazil](https://www.claro.com.ar/personas/roaming/brasil).
- Public retail and the 220-destination count: [provider home](https://citrusmobile.com/), [rates](https://citrusmobile.com/rates), [Chile](https://citrusmobile.com/chile), [Brazil](https://citrusmobile.com/brazil), [Uruguay](https://citrusmobile.com/uruguay), [Paraguay](https://citrusmobile.com/paraguay), [Bolivia](https://citrusmobile.com/bolivia).

## Channels, in order

### Sales channels (planned)

**Planned. Nothing here is running.** As of 8 October 2026 no terminal, agency, creator, or wallet company has been contacted, no QR is up, and no referral fee has been paid. The same table is in the README under Go-to-market / Sales channels.

The first five channels are for Argentine travelers leaving for Chile, Brazil, Uruguay, Paraguay, or Bolivia. CAC is cash spent on that channel divided by travelers who finish a deposit. Conversion is deposits divided by scans, links, or referrals. The pilot ask is ten real trips in the next 60 days.

| Channel | Why it fits | Cost | How we would measure it |
|---|---|---|---|
| Point of departure | Bus terminals, border crossings, and airports on the Jujuy–Salta corridor, where people leave for Chile and Bolivia. A QR is the deposit link at the moment they need data. Brazil, Uruguay, and Paraguay use the same QR with agencies and groups that sell those trips. | Printing, and permission to put a poster up. No site has agreed. | Scans to deposits. CAC = print cost / deposits. |
| Travel agencies and tour operators | They sell packages to the neighbor countries and talk to the traveler when the trip is booked. | No retainer. A referral fee in USDC, paid automatically from the per-GB margin, only after a deposit. The fee is not set, and that payment is not in the code. Gross margin before the fee is 0.83 USDC/GB in Chile, Brazil, and Uruguay, 0.92 in Bolivia, and 1.75 in Paraguay. A first trip still has the $1.75 eSIM issue fee. | Referrals to deposits. CAC = fees paid / deposits. |
| Crypto communities | Early adopters who already hold USDC and a Solana wallet. The founder runs jujuy.dev and counts 430+ members. Superteam Argentina is the other room the team can post in. That count is reach, not customers. | Time. No sponsorship and no deal. | Posts to deposits. Cash CAC is about zero. |
| Traveler groups and creators | Facebook and WhatsApp groups, and creators who post border trips, for people outside crypto communities. | Time, or a creator fee if one is paid. No group and no creator is signed. | Link clicks to deposits. CAC = fees / deposits. |
| Wallet links | A Phantom or Solana Pay link is the deposit behind the QR and the referral. It does not need a wallet company to agree. | Build time. No integration deal. | Links opened to deposits. |

Later, and still uncontacted: an Argentine wallet or exchange (Lemon, Belo, Ripio), whose users hold stablecoins and mostly do not hold USDC on Solana, and hostels or hotels, which reach foreign travelers arriving in Argentina. Those are outside the first segment.

## The traveler without a wallet

Not solved. Today the buyer needs Phantom or Solflare and USDC on Solana. A Solana Pay link for the deposit, and a short guide, are the planned wallet channel above. Neither is built.

## Next experiment

Ten sessions with real travelers on a real trip, with a real eSIM. Owner: Joel.

What it measures: how many finish the deposit without help, how many gigabytes they use, what share of the deposit is refunded, and whether they would pay again.
