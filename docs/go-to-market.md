# Go-to-market

**Date:** 2026-10-07 · **Status:** a plan with published costs. No channel has been contacted and nothing has been sold.

## Who buys

The Argentine traveler who already saves in USDC and is going abroad. User and buyer are the same person.

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

This is the argument for the Argentine traveler, and it is not written yet. It needs two real quotes with source and date:

| | Price for 1 GB in Brazil | Source and date |
|---|---|---|
| AstroAm, paid in USDC | 2.48 USDC (on Vivo) | Citrus rates, 2026-10-07 |
| A travel eSIM paid with an Argentine card, surcharges included | to quote | |
| Roaming from an Argentine carrier | to quote | |

One data point so far, from the founder's own trip: US$15 to US$30 of carrier roaming for a trip to a neighboring country, paid with an Argentine card, with about half of it unused. See [validation.md](validation.md).

## Channels, in order

None has been contacted as of 2026-10-07.

1. **Crypto communities where the team already has reach**: jujuy.dev and Superteam Argentina. These people already hold USDC and have a Solana wallet, so nothing has to be explained first. The ask: ten travelers with a trip in the next 60 days, for the pilot.
2. **An Argentine wallet or exchange** (Lemon, Belo, Ripio). Their users hold stablecoins. The proposal is a referral fee per traveler who activates.
3. **A travel agency in Jujuy or the Argentine northwest.** It reaches travelers at the moment they book.
4. **A hostel or hotel.** It reaches foreign travelers arriving in Argentina, who need data in Argentina.

Channels 3 and 4 reach people who mostly do not hold USDC. They need the step that is still missing: getting a wallet and USDC without help.

## The traveler without a wallet

Not solved. Today the buyer needs Phantom or Solflare and USDC on Solana. A Solana Pay QR for the deposit and a short guide are on the roadmap.

## Next experiment

Ten sessions with real travelers on a real trip, with a real eSIM. Owner: Joel.

What it measures: how many finish the deposit without help, how many gigabytes they use, what share of the deposit is refunded, and whether they would pay again.
