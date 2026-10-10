# Pitch script (2:00)

Voice-over for [`promo.html`](promo.html). Each block starts at the scene's `data-start`, so the voice and the animation line up when they are mixed. About 310 words, roughly 155 words a minute. Record in English, add subtitles, and keep the final cut at 2:00 or less.

Every claim below is backed in the repo. If one of them changes, change the line, not the evidence:

| Claim | Source |
|---|---|
| 30% percepción on card payments | [README, pricing](../../../README.md#pricing-vs-what-argentine-travelers-pay-today) |
| 10 USDC, 0.625 used, 9.375 back | Example at the app's Brazil rate |
| Timeout pays what was attested, refunds the rest | `programs/astroam-escrow/src/lib.rs`, [README, Solution](../../../README.md#solution) |
| 22 program tests | `programs/astroam-escrow/tests/escrow.rs` |
| One real Citrus eSIM settled on devnet | [docs/real-esim.md](../../real-esim.md#run-of-2026-10-09) |
| 10 interviews, half skip data, 4 of 10 hold digital dollars | [docs/validation.md](../../validation.md) |
| 2.48 USDC/GB, 0.83 USDC/GB margin | [README, pricing](../../../README.md#pricing-vs-what-argentine-travelers-pay-today) |

Do not say "a real eSIM from Citrus" about the demo, and do not say "nobody on our team can touch" the vault. The demo uses a sample eSIM, and the upgrade authority is still one team key until the Squads multisig exists.

## Script

| Time | Scene | Voice-over |
|---|---|---|
| 0:00–0:06 | Cold open | "I'm an Argentine traveler. I just landed in São Paulo, and my phone says: no service." |
| 0:06–0:20 | Problem | "My options: carrier roaming, and a surprise on next month's bill. Or an eSIM pack paid with my Argentine card, plus thirty percent percepción. Whatever I don't use expires. I paid for it anyway." |
| 0:20–0:27 | Insight | "But many of us already save in digital dollars. Nobody gives the data we don't use back to our own wallet." |
| 0:27–0:30 | Logo | "AstroAm fixes that." |
| 0:30–0:37 | Deposit | "You deposit USDC once, with one signature in Phantom. It goes into an escrow program on Solana, not to us." |
| 0:37–0:44 | Connect | "Scan the QR, and you're online. This demo uses a sample eSIM." |
| 0:44–0:54 | Travel | "Usage is read from the eSIM provider. Our meter signs a running total, the Solana program verifies it, and your eSIM is topped up in small tranches. No popups. No transaction per megabyte." |
| 0:54–1:04 | Example | "Say you deposit ten USDC and use 250 megabytes in Brazil. One close pays 0.625, and sends 9.375 back to your wallet." |
| 1:04–1:14 | Trust | "We can never charge more than you deposited. Every voucher is public on the explorer. And if we disappear, after seven days anyone can close: what was measured is paid, and the rest comes back to you." |
| 1:14–1:26 | Evidence | "It runs on Solana devnet today, with 22 program tests and one real Citrus eSIM settled on-chain. Of ten travelers we interviewed in Jujuy, half skip mobile data abroad, and four already hold digital dollars." |
| 1:26–1:37 | Customer and business | "Our customer is the Argentine traveler to Chile, Brazil and Uruguay. They pay 2.48 USDC per gigabyte they use, less than a card eSIM. We keep 0.83 of it." |
| 1:37–1:48 | Team | "We're four builders from Jujuy: Franco on the escrow program, Ignacio on eSIM connectivity, Daniel on metering and the interviews, and Joel on the app. We live next to the border. We are the traveler." |
| 1:48–2:00 | Next milestone | "Next: an agency pilot in Jujuy, ten real trips, a Squads multisig, then mainnet. AstroAm. Pay only for the data you use." |

## Recording checklist

1. Render the animation: `node render.mjs video promo.mp4` (see [README](README.md)).
2. Record the voice block by block against the times above. If a block runs long, cut words, not the animation.
3. Mix, add burned-in English subtitles, and check the length is 2:00 or less.
4. Replace `docs/demo/AstroAm-pitch-EN.mp4`, upload to Vimeo as public, open the link in a private window, and update Colosseum, Superteam Earn, and the chapter form.
