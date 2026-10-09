# Decision: Citrus + Bridge to automate the fund flow

**Date:** 2026-10-05 · **Status:** the escrow (vouchers signed by the meter
key, checkpoints and claims), the tranche funding, and the automatic
collection and close are implemented and tested; the new program is on devnet
(`HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk`). The eSIM has been tested
with the real provider (Citrus) and works. Bridge and the Citrus card are
still pending (§6).

> **Update 2026-10-07.** Citrus's auto-refill does not work the way §1 and §2
> assume. It is set on the account, as a threshold and an amount: when the
> reseller balance drops below the threshold, Citrus charges the saved card.
> But only real spend triggers it, and funding an eSIM is a transfer, not
> spend. For AstroAm the only real spend is creating an eSIM ($1.75). So the
> balance can fall through tranche funding without a charge, and a declined
> card turns auto-refill off until someone turns it on again by hand. Source:
> Citrus's [full reference](https://citrusmobile.com/llms-full.txt) and the
> auto-refill screen of the reseller dashboard. Whether creating an eSIM
> charges the card when tranches already took the balance below the threshold
> is not confirmed. The architecture that results, and the options for the
> money, are in [`fund-flow-architecture.md`](fund-flow-architecture.md).

This decision **replaces and extends** the proposal on the branch
`docs/automatizar-flujo-de-fondos`
(`docs/decisiones/automatizar-flujo-de-fondos.md`). That one left the treasury
rail open (collected USDC → the reseller account's USD). This one closes it:
**Bridge** liquidates Solana USDC to AstroAm's bank account, and that account
backs the **saved card** Citrus refills itself with. The escrow keeps the
session key and small tranches. It does not change app code.

Product context already decided: metering with the provider
([`medicion-con-proveedor.md`](medicion-con-proveedor.md)) and the Citrus
model ([`../citrus-mobile-brief.md`](../citrus-mobile-brief.md)).

## 1. Problem

AstroAm sells prepaid mobile data. The traveler deposits **Circle USDC** into
a Solana escrow. Usage is measured off-chain. One close pays AstroAm what was
used and returns the rest to the traveler in the same transaction.

Citrus (wholesale eSIM provider) charges in **dollars through Stripe**. It
does not accept USDC or any other crypto. There is no API to top up the
reseller balance: the top-up is in the developer dashboard, with a minimum of
about $10 in the reseller documentation. Funding eSIMs is an API call:
`POST /esim/{iccid}/fund`. Shared-balance groups also draw from the reseller
balance.

There is **auto-refill with a saved card** when a shared group's balance
drops (`group.balance_low`, the account's auto-refill). The reseller
account's events include `balance.auto_refill_succeeded` and
`balance.auto_refill_failed` (see the brief).

The traveler's eSIM has to stay **standalone**. A SIM inside a group has no
wallet or usage of its own (`wallet_balance_usd` and `total_data_charged_usd`
come back `null`), and the product bills per user. Auto-refill is the
account's mechanism, not a reason to put the traveler in a group. Whether
auto-refill also fires when the reseller balance drops **without** a shared
group was **unknown** when this was written; see the update above.

Documentation: [citrusmobile.com/developer/docs](https://citrusmobile.com/developer/docs).
Support: support@citrusmobile.com.

Today the loop does not close by itself. AstroAm advances USD to the eSIM and
only collects USDC at `close`. The collected USDC does not go back to dollars
by itself, and the Citrus dashboard has to be loaded by hand.

## 2. Recommended solution

**Bridge** ([bridge.xyz](https://bridge.xyz)) creates a *liquidation address*
on **Solana / USDC** that points at AstroAm's bank account. When USDC
arrives, Bridge converts it and deposits USD by ACH, wire or FedNow. Creating
the address and the routing are done through the API.

- Published minimum: **about $1** on the Solana USDC → USD by ACH route
  ([payment routes](https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes)).
- Orchestration fee of **roughly 0.25%**, plus the cost of the rail. ACH is
  close to zero. The exact cost of wire and FedNow, and the time each rail
  takes, are **unknown** until the account is open. No other fees are fixed
  in this decision.
- Reference for the address:
  [Liquidation address](https://apidocs.bridge.xyz/platform/orchestration/liquidation_address/liquidation_address).

That bank pays and backs the **saved card** for Citrus's auto-refill. The
loop looks like this:

```
Traveler ─USDC─▶ Solana escrow
                    │ deposit (one signature)
                    ▼
              backend provisions the eSIM
              and funds a small tranche
              POST /esim/{iccid}/fund
                    │
                    ▼
         Citrus reseller balance ──auto-refill──▶ saved card
                    ▲                                 │
                    │                                 ▼
              USD in the bank ◀── Bridge liquidates USDC
                    ▲              (treasury / escrow close)
                    │
              close: pays what was used, returns the rest
```

1. The traveler deposits USDC into the escrow.
2. The backend provisions (or reuses) the eSIM and funds small tranches
   through the Citrus API, drawing from the reseller balance.
3. When the Citrus account runs low, the card auto-refill tops the balance
   up. No manual top-up in the dashboard is needed once the card and the
   auto-refill are set up.
4. When the escrow closes (and in the treasury sweep), the collected USDC is
   sent to the liquidation address. Bridge deposits USD in the bank that
   backs that card.

The eSIM loop becomes automatic. What stays manual, until the steps below,
is opening Bridge, saving the card and turning auto-refill on.

## 3. Alternatives considered

**Circle Mint** ([docs](https://developers.circle.com/circle-mint),
[circle.com](https://www.circle.com)). USDC on Solana → payout to the bank by
wire or RTP, through an API. It fits in the same place as Bridge. It is more
enterprise and asks for KYB. Bridge is lighter for a permanent liquidation
address. Circle Mint's fees and timing: **unknown** here.

**Rain** ([rain.xyz](https://www.rain.xyz)). A virtual Visa funded with USDC,
Solana included. That card could pay Citrus's Stripe directly, without the
bank → card step. It is the cleanest path end to end, and also the one that
asks for the most KYC and a card program. Fees: **unknown**.

**Cryptorefills** ([cryptorefills.com](https://www.cryptorefills.com),
[solana.x402.cryptorefills.com](https://solana.x402.cryptorefills.com)). It
charges USDC on Solana through an API or x402 and does not require a prepaid
reseller balance. It charges the whole product at purchase: paying per MB
and refunding the unused balance are lost. Fees: **unknown**.

**ZeroID** ([zeroid.to/reseller](https://zeroid.to/reseller)). Prepaid with a
minimum of about $300 in SOL or USDT. It is not the pay-per-MB model with a
refund of what was not used.

## 4. Escrow (Solana)

The program (`programs/astroam-escrow`) required, when this was written, that
`close` carry the traveler's signature. The `refund` at 7 days
(`SOLANA_TIMEOUT_SECONDS`) returned the **whole** deposit if nobody closed.
AstroAm lost what it had already funded in Citrus. The same on a trip longer
than 7 days: the traveler could use data and then claim the full refund.

**Product.** A **session key** is registered at deposit. The traveler signs
once. The backend closes with that key. The cap is still the deposit.

**Tranches of $2–$3.** The next tranche is funded in Citrus only when a
voucher covers the previous one, and what is funded fits in the deposit. If
the traveler disappears, the most AstroAm loses is **one tranche** (Citrus
cuts data when the eSIM's wallet reaches $0).

**Demo.** Periodic signatures with Phantom, without changing the program. It
is enough to show the cycle. It does not scale: each tranche is a popup and,
with the app closed, there is no signature.

**Product = session key + partial claims.** A `claim` transfers to AstroAm
what has accumulated so far without closing the escrow, so the timeout stops
threatening long trips. The risk drops to what was used since the last claim
(in practice, one tranche).

**Yield (open option, not implemented).** While the USDC sits in the escrow,
lending on Solana can be evaluated, for example **Kamino** or **Marginfi**,
to earn yield. It is not implemented in this decision. **Who gets the yield**
(traveler or platform) is open. The liquidity risk, how long funds cannot be
withdrawn, and the effect on the 7-day `refund` are **unknown** until a
separate design (step 5).

## 5. Decision

Stay with **Citrus + Bridge + card auto-refill + session key with
tranches**.

Do not switch to Cryptorefills or ZeroID while the differentiator is
refunding the unused megabytes. Circle Mint and Rain remain valid
alternatives if Bridge does not pass KYB, or if paying Stripe with a
USDC-funded Visa is better; they are not the default path.

Next steps:

1. Open the Bridge account and create the Solana / USDC liquidation address
   pointing at AstroAm's bank.
2. Set up the saved card and auto-refill in Citrus.
3. Specify the change to the escrow program: session key at deposit and
   partial claims. The demo can keep using Phantom signatures.
4. Write to support@citrusmobile.com and ask whether the reseller account
   accepts wire, ACH or crypto, and whether the account's auto-refill fires
   without a shared group (traveler eSIMs have to stay standalone).
5. Evaluate yield on Kamino or Marginfi in a separate design, including who
   it is assigned to.

## 6. Implementation status

Done in the code:

- **Program** (`programs/astroam-escrow`): the config (106 bytes) stores
  AstroAm's **meter key**, and it is the only key that can sign a cumulative
  voucher (ed25519 over `(program id, escrow id, amount)`). `deposit` can
  register a session key, but that key does not sign vouchers. `checkpoint`
  records the latest voucher without moving USDC and without restarting the
  timeout; `claim` collects the part of the voucher not collected yet and
  leaves the escrow open; `close` requires a voucher between what was already
  attested and the deposit. The timeout runs from the deposit, the last
  `topUp` or the last `claim`, and `refund` pays the payee the attested
  amount not collected yet and returns only the rest to the traveler.
  Escrows from the first deployment can still be closed and refunded.
- **App**: the traveler signs once, the deposit. After each usage reading
  the app calls `POST /api/missions/:id/attest` and, when the trip ends,
  `POST /api/missions/:id/settle`. Neither opens the wallet.
- **Backend**: signs the vouchers with `SOLANA_METER_KEYPAIR` and records
  them with `checkpoint`; funds the eSIM one tranche ahead of the voucher,
  collects with `claim`, closes with `close` and sweeps what was collected to
  `BRIDGE_LIQUIDATION_ADDRESS` (`src/solana/meter-signer.ts`,
  `src/product/services/fund-flow.ts`, `src/jobs/fund-flow.ts`,
  `src/solana/EscrowChain.ts`). With `SOLANA_OPERATOR_KEYPAIR` the deposit is
  read from the escrow, not from the request.

Differences from what is written above:

- **Who signs the voucher.** §4 proposed that the backend close with the
  traveler's session key. It ended up being AstroAm's meter key: the traveler
  cannot block the close or understate usage by refusing to sign. The cap is
  still the deposit, and every voucher is on the explorer to audit against
  the provider's usage record.
- **Tranche.** It does not wait for a voucher to cover the whole previous
  tranche, because the eSIM's wallet would reach $0 and Citrus would cut data
  before the next one was funded. The rule is that what is funded never
  exceeds what the vouchers cover plus one tranche. The most that can be lost
  is still one tranche.
- **Timeout.** It no longer returns the whole deposit: it pays what the last
  `checkpoint` or `claim` attested. What AstroAm can lose is what was used
  after the last recorded voucher.

Deployed: since the config grew to 106 bytes, the new code is a new program
on devnet, `HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk` (meter
`3WqaNhVVCCnabBLGA9YWviQHDvo6fTmX1Y9otcmsdB7k`). The first one,
`8QXPo6yVxZuC3goYzHVLsxVkE1J6BaEqZvfW9e3Do2uq`, could not be updated with
`--upgrade`. Deposit, checkpoint, claim and close on that devnet program were
tested with FakeProvider. Separately, the eSIM has been tested with the real
provider (Citrus) and works ([`../real-esim.md`](../real-esim.md)).

Pending, outside the code: steps 1, 2, 4 and 5 of §5, and the test of `refund`
after the timeout. Citrus's webhooks
(`esim.balance_depleted`, `esim.defunded`) update the eSIM record but do not
trigger the fund flow: today it learns from the periodic reading.

## Links

- Bridge: https://bridge.xyz
- Liquidation address: https://apidocs.bridge.xyz/platform/orchestration/liquidation_address/liquidation_address
- Payment routes (minimums per rail): https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes
- Circle Mint: https://developers.circle.com/circle-mint
- Rain: https://www.rain.xyz
- Cryptorefills: https://www.cryptorefills.com
- ZeroID reseller: https://zeroid.to/reseller
- Citrus developer docs: https://citrusmobile.com/developer/docs
