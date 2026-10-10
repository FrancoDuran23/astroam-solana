# From a sample eSIM to a real one

**Date:** 2026-10-07, updated 2026-10-09 · **Status:** one controlled run done on 2026-10-09 (below). The public demo still uses the sample profile. Owner: Joel.

The escrow is real: it is deployed on devnet and a full session is linked in the [README](../README.md#live-on-devnet). On 2026-10-09 one real Citrus eSIM was issued from the flow, used on a phone, and settled on devnet. This page records that run, lists what is still simulated in the public demo, why setting the Citrus key alone does not produce a working line, and the steps to repeat the run.

## Run of 2026-10-09

Run by Ignacio on a laptop, following [One controlled real run](#one-controlled-real-run), with `CONNECTIVITY_PROVIDER=citrus`, the operator and meter keys of the program in `.env.example`, `ENABLE_DEMO_TRAFFIC=false` and `CLAIM_MIN_USDC=0.5`. The eSIM was installed on a phone in Argentina and used for mobile data. Mission `mis_1791579588979_k5k4wl`, destination Argentina, budget 2 USDC.

| Step | Time (UTC) | Evidence |
|---|---|---|
| Deposit, 2 USDC, signed in Phantom | 21:00:11 | [5PPimRAd…98DtDT](https://explorer.solana.com/tx/5PPimRAd4i2Kdd3RccjZquZeTXanYiZGxbvYzr5KGJfhVixJBnz9sYQephhbuKuTjLYvQNTaPmFd2v57Ei98DtDT?cluster=devnet). Escrow `D68cVrupJ283y4rGvpbmz9tzcPEtCCq9EPNyLH2kzdqV` |
| Real eSIM issued by Citrus | 21:00:20 | ICCID `891030*********8224`, `isMock=false` |
| eSIM wallet funded | 21:00:21 | One tranche of $1.33, the most a 2 USDC deposit pays for at the 1.5× markup |
| First usage reading from Citrus | 21:21:08 | Citrus charged $0.19 on this eSIM. At the 1.5× markup that is 0.285 USDC. At the app's Argentina rate (0.0026 USDC/MB) the API counts it as 109.62 MB equivalent. Citrus reports dollars charged, not bytes, so the megabytes are derived, not measured |
| Meter voucher and checkpoint | 21:21:08 | The meter key signed 0.284999 USDC. [5hSbPPHg…HaBc7](https://explorer.solana.com/tx/5hSbPPHgQmdoXBGf9ViDk7p6KNy5KFEfNswTFbMfwY1RceGtpEkMqZoLQfvjFq7ApfvAUxWGTosCNDrZ1KqHaBc7?cluster=devnet) |
| Close, sent by the backend when the trip was ended in the app | 21:21:39 | [4z7z7gFi…HCGfL](https://explorer.solana.com/tx/4z7z7gFieZw94wTQLPPJ1is895nBNr58VUfrzhBTridPLKLCVvPLGdFz4Lk1A1ZFacw48Hfp6HXR5748uzBHCGfL?cluster=devnet): 0.284999 USDC to the payee, 1.715001 USDC back to the traveler |

All three transactions were read back with `getTransaction` on `https://api.devnet.solana.com`: no error, and each one calls `HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk`. The token balances in the close match the log: the vault went from 2 to 0, the payee gained 0.284999 and the traveler 1.715001.

The full mission log the API wrote during the run is in [evidence/2026-10-09-real-esim-mission-log.txt](evidence/2026-10-09-real-esim-mission-log.txt). How that log works is in the [README](../README.md#mission-log).

What this run shows, and what it does not:

- It shows the whole path once with a real line: issue, fund, a usage reading from the provider, a meter voucher, a checkpoint and a close that refunds the rest, with no signature from the traveler after the deposit.
- No `claim` was sent: 0.285 USDC was under the 0.5 USDC claim threshold, so the close paid the whole amount.
- The first reading took about 21 minutes after the funding, in line with Citrus's reporting delay.
- The close asks Citrus to return the unused eSIM balance ($1.11 at the last reading) to the reseller account. That return is not in the mission log and was not checked.
- It is one run by a team member, not a traveler on a trip. The roadmap item is still 10 sessions with travelers.

## What is simulated today

| Piece | Today | What makes it real |
|---|---|---|
| eSIM profile | `FakeProvider` returns a sample QR. No line is issued. | `CONNECTIVITY_PROVIDER=citrus` and `CITRUS_API_KEY`, plus the two Solana keys below. |
| Usage | The **Use 250 MB** button injects traffic. | `ENABLE_DEMO_TRAFFIC=false`. Usage is then what Citrus reports for that eSIM. |
| Prices in the app | A fixed table of sample rates. | Read `GET /rates` from Citrus. Not built. |
| USDC | Circle's devnet USDC. It has no value. | Mainnet. Out of scope for the hackathon. |
| Demo video | Recorded with a stand-in wallet. | Record again with Phantom on devnet. |
| Collected USDC to dollars | Nothing moves. | A Bridge account, or a manual conversion each month. |
| Withdrawal button on `/terms` | Stores the request in the browser only. | A real contact and a legal review. |

Two pieces are real but could be mistaken for simulated. The budget assistant follows fixed rules and calls no model; the app says so. `PAYMENT_RAIL=fake` only keeps the demo's metering in memory; the USDC moves through the escrow program, not through that rail.

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

## One controlled real run

Run it on a laptop, not on a public URL (see the next section).

1. Check the Citrus reseller balance. The run needs $1.75 for the eSIM and $2.50 for the first tranche. Keep at least $10.
2. Put the five variables above in a local `.env`. For a short test, also set `CLAIM_MIN_USDC=0.5` so a claim happens with little usage.
3. Run `npm run real:check`. It reads the Citrus balance and the program config, checks that both keys belong to this program, and lists what is still missing. It spends nothing.
4. Start the API and the app. The API log should say `fund flow is automatic` and name the operator.
5. In the app, start a mission with a 5 USDC budget and pay from Phantom on devnet. A 5 USDC deposit pays for $3.33 of eSIM wallet at the 1.5× markup, enough for one full tranche.
6. The API log should show `esim tranche funded` with `amountCents: 250`. If it does not, the deposit was not read from the escrow: check the operator key.
7. Scan the QR with a phone. It is a real install code now. Citrus covers Argentina, so the test can be done at home.
8. Use some data. Citrus reports usage about every 10 minutes and pauses reporting for about 15 minutes after each funding, so the first reading takes that long to appear.
9. When usage shows, the meter signs it and the API writes a checkpoint on the escrow. End the mission in the app. The close pays AstroAm what was used and returns the rest.
10. Write down: the ICCID with the middle digits hidden, the usage Citrus reported, and the explorer links of the deposit, a checkpoint and the close. Link them from the README.

What the run costs in real money: $1.75, plus whatever data is used. The part of the tranche that is not used goes back to the reseller balance when the trip closes. The USDC is devnet USDC.

## Do not put the Citrus key on the public demo

Devnet USDC is free from a faucet. A public API holding a Citrus key would let anyone deposit free USDC and spend real reseller dollars: $1.75 per eSIM and up to a tranche each. The public demo therefore stays on the sample profile, and the real eSIM is shown with the recorded run.

Charging real money for real data needs mainnet USDC, and with it an audit of the program, the multisig, and the legal review.

## What still would not be real after that run

- **Prices.** The traveler is charged what Citrus charged, times 1.5. The table in the app is a sample: it matches Citrus's cheapest network per country, and a phone can connect to a dearer one.
- **Speed of usage.** A reading takes 10 to 15 minutes to arrive, so the balance on screen lags.
- **Citrus webhooks.** `esim.balance_depleted` and `esim.defunded` are not wired to this flow. It learns by polling.
- **State across restarts.** The demo metering lives in memory. A restart between the deposit and its confirmation loses that step.
- **Dollars.** Collected USDC stays with the payee key until someone converts it.
