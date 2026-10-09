# eSIM with Citrus

The eSIM has been tested with the real provider (Citrus) and works. Citrus is called when `CONNECTIVITY_PROVIDER=citrus`.

The escrow is deployed on devnet and a full session is linked in the [README](../README.md#live-on-devnet). This page lists what a public or local demo may still leave off, why a Citrus key alone does not fund a line, and how a private run is set up. It does not record ICCIDs, usage figures, or a date for the Citrus test.

## What a demo may still leave off

| Piece | On a demo that does not spend reseller credit | What calls Citrus |
|---|---|---|
| eSIM profile | `CONNECTIVITY_PROVIDER=fake` keeps an in-memory profile. This is a deployment choice. Each real provision costs about 1.75 USD. | `CONNECTIVITY_PROVIDER=citrus` and `CITRUS_API_KEY`, plus the two Solana keys below. That path has been tested and works. |
| Usage | The **Use 250 MB** button injects traffic. | `ENABLE_DEMO_TRAFFIC=false`. Usage is then what Citrus reports for that eSIM. |
| Prices in the app | A fixed table of sample rates. | Read `GET /rates` from Citrus. Not built. |
| USDC | Circle's devnet USDC. It has no value. | Mainnet. Out of scope for the hackathon. |
| Demo video | Recorded with a stand-in wallet. | Record again with Phantom on devnet. |
| Collected USDC to dollars | Nothing moves. | A Bridge account, or a manual conversion each month. |
| Withdrawal button on `/terms` | Stores the request in the browser only. | A real contact and a legal review. |

The budget assistant follows fixed rules and calls no model; the app says so. `PAYMENT_RAIL=fake` only keeps the demo's metering in memory; the USDC moves through the escrow program, not through that rail.

## Why the Citrus key alone is not enough

With `CONNECTIVITY_PROVIDER=citrus` and a valid key, the API does create a real eSIM, and Citrus charges $1.75 for it. That eSIM starts with a $0 wallet, and a $0 wallet passes no data.

The API funds the eSIM only for a deposit it has read from the escrow account itself (`depositVerified`). It does that read with the operator key. Without `SOLANA_OPERATOR_KEYPAIR` the deposit is taken on the app's word, so no tranche is funded.

After the first tranche, the next ones are funded only as meter vouchers cover what was already funded. Signing those vouchers needs the meter key of the deployed program. Without `SOLANA_METER_KEYPAIR` the trip gets one tranche and cannot be closed by the backend.

So a working line needs all of these on the same API process:

| Variable | Why |
|---|---|
| `CONNECTIVITY_PROVIDER=citrus` | Selects the real provider. |
| `CITRUS_API_KEY` | The reseller key (`rsk_…`). |
| `SOLANA_OPERATOR_KEYPAIR` | Reads the deposit from the escrow, which unlocks funding, and sends checkpoint, claim and close. |
| `SOLANA_METER_KEYPAIR` | Signs the usage vouchers. It must be the key the program was initialized with. |
| `ENABLE_DEMO_TRAFFIC=false` | Removes the button that invents traffic. |

For the program in `.env.example`, Ignacio holds both key files. Without them, deploy your own program as in [Test with your own deploy](../README.md#test-with-your-own-deploy); the deploy prints the values to use.

## How a private Citrus run is set up

The eSIM has already been tested end to end with Citrus and works. The list below is the setup for that kind of run. It is not a log of amounts or a date. Run it on a laptop, not on a public URL (see the next section).

1. Check the Citrus reseller balance. The run needs $1.75 for the eSIM and $2.50 for the first tranche. Keep at least $10.
2. Put the five variables above in a local `.env`. For a short test, also set `CLAIM_MIN_USDC=0.5` so a claim happens with little usage.
3. Start the API and the app. The API log should say `fund flow is automatic` and name the operator.
4. In the app, start a mission with a 5 USDC budget and pay from Phantom on devnet. A 5 USDC deposit pays for $3.33 of eSIM wallet at the 1.5× markup, enough for one full tranche.
5. The API log should show `esim tranche funded` with `amountCents: 250`. If it does not, the deposit was not read from the escrow: check the operator key.
6. Scan the QR with a phone. It is a real install code now. Citrus covers Argentina, so the test can be done at home.
7. Use some data. Citrus reports usage about every 10 minutes and pauses reporting for about 15 minutes after each funding, so the first reading takes that long to appear.
8. When usage shows, the meter signs it and the API writes a checkpoint on the escrow. End the mission in the app. The close pays AstroAm what was used and returns the rest.
9. Write down: the ICCID with the middle digits hidden, the usage Citrus reported, and the explorer links of the deposit, a checkpoint and the close. Link them from the README.

What the run costs in real money: $1.75, plus whatever data is used. The part of the tranche that is not used goes back to the reseller balance when the trip closes. The USDC is devnet USDC.

## Do not put the Citrus key on the public demo

Devnet USDC is free from a faucet. A public API holding a Citrus key would let anyone deposit free USDC and spend real reseller dollars: about 1.75 USD per eSIM and up to a tranche each. The public demo therefore keeps `CONNECTIVITY_PROVIDER=fake`. That is a deployment choice. The eSIM has been tested with Citrus and works on a run that sets `CONNECTIVITY_PROVIDER=citrus`.

Charging real money for real data needs mainnet USDC, and with it an audit of the program, the multisig, and the legal review.

## What that test does not change

- **Prices.** The traveler is charged what Citrus charged, times 1.5. The table in the app is a sample: it matches Citrus's cheapest network per country, and a phone can connect to a dearer one.
- **Speed of usage.** A reading takes 10 to 15 minutes to arrive, so the balance on screen lags.
- **Citrus webhooks.** `esim.balance_depleted` and `esim.defunded` are not wired to this flow. It learns by polling.
- **State across restarts.** The demo metering lives in memory. A restart between the deposit and its confirmation loses that step.
- **Dollars.** Collected USDC stays with the payee key until someone converts it.
