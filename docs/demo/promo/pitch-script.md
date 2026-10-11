# Pitch script (2:00)

Voice-over for [`promo.html`](promo.html). Each block starts at the scene's `data-start`, so the voice and the animation line up when they are mixed. About 290 words, roughly 150 words a minute. Record in English, add subtitles, and keep the final cut at 2:00 or less.

The timing follows the structure Superteam Argentina recommended in its 2026-10-09 feedback, and covers the eight elements the chapter rubric checks: problem, insight, what we sell, customer, business model, evidence, team, and next milestone.

| Element | Where | Time |
|---|---|---|
| Problem | Argentine traveler, card percepción, unused data lost | 0:00–0:15 |
| Insight | Closed packs keep the unused part; travelers already hold digital dollars | 0:15–0:25 |
| What we sell | Positioning line, then deposit, sample eSIM, metering, refund, trust | 0:25–1:02 |
| Evidence | Devnet session, 22 tests, one real Citrus eSIM, 10 interviews | 1:02–1:16 |
| Customer | Argentine traveler to Chile, Brazil, Uruguay | 1:16–1:22 |
| Business model | 2.48 USDC/GB against the card, 0.83 USDC/GB margin, agencies first | 1:22–1:35 |
| Team | Four names, roles, why Jujuy | 1:35–1:47 |
| Next milestone | 10 real trips, Squads, mainnet, closing line | 1:47–2:00 |

Every claim is backed in the repo. If one of them changes, change the line, not the evidence:

| Claim | Source |
|---|---|
| 30% percepción on card payments; 2.48 USDC/GB; at least 21% below the cheapest card eSIM in Chile, Brazil and Uruguay; 60% or more below a half-used pack; 0.83 USDC/GB margin | [README, pricing](../../../README.md#pricing-vs-what-argentine-travelers-pay-today) |
| 10 USDC, 0.625 used, 9.375 back | Example at the app's Brazil rate |
| Timeout pays what was measured, refunds the rest | `programs/astroam-escrow/src/lib.rs`, [README, Solution](../../../README.md#solution) |
| 22 program tests | `programs/astroam-escrow/tests/escrow.rs` |
| One real Citrus eSIM settled on devnet | [docs/real-esim.md](../../real-esim.md#run-of-2026-10-09) |
| 10 interviews, half skip mobile data, 4 of 10 hold digital dollars | [docs/validation.md](../../validation.md) |
| Agencies in Jujuy as the first channel | [docs/validation.md, outreach log](../../validation.md#4-distribution-channel--agency-outreach-log). Invited, no answer yet: say "first channel", not "partner". |

Do not say:
- "a real eSIM from Citrus" about the demo. The demo uses a sample eSIM; one real line ran once, on 2026-10-09.
- "nobody on our team can touch" the vault. The upgrade authority is one team key until the Squads multisig exists.
- "the full deposit returns" on timeout. What was measured is paid first.

## Script

| Time | Scene | Voice-over |
|---|---|---|
| 0:00–0:05 | Cold open | "I'm an Argentine traveler. I land in São Paulo: no service." |
| 0:05–0:15 | Problem | "Roaming shows up on next month's bill. An eSIM pack on my Argentine card adds thirty percent percepción, and whatever I don't use, I lose." |
| 0:15–0:25 | Insight | "eSIMs sell closed packs and keep what you don't use. Many of us save in digital dollars, but nobody returns the unused part to our wallet." |
| 0:25–0:30 | Logo | "AstroAm: pay in USDC, skip the percepción, and get back what you don't use." |
| 0:30–0:36 | Deposit | "You deposit USDC once, signing in Phantom, into an escrow program on Solana. Not to us." |
| 0:36–0:40 | Connect | "Scan the QR, and you're online. This demo uses a sample eSIM." |
| 0:40–0:47 | Travel | "Our meter signs your usage, the Solana program verifies it, and your eSIM tops itself up. No popups." |
| 0:47–0:55 | Example | "Deposit ten USDC and use 250 megabytes in Brazil: one close pays 0.625, and sends 9.375 back to your wallet." |
| 0:55–1:02 | Trust | "We can't charge more than your deposit. After seven days, anyone can close: what you used is paid, the rest comes back." |
| 1:02–1:16 | Evidence | "It runs on Solana devnet today: 22 program tests, and one real Citrus eSIM issued from the flow and settled on-chain. We interviewed ten travelers from Jujuy: half skip mobile data abroad; four already hold digital dollars." |
| 1:16–1:35 | Customer and business | "Our customer: the Argentine traveler to Chile, Brazil and Uruguay. They pay 2.48 USDC per gigabyte used: at least 21 percent below the cheapest card eSIM, and 60 percent or more when they use half. We keep 0.83 per gigabyte. Our first channel: travel agencies in Jujuy." |
| 1:35–1:47 | Team | "We're four builders from Jujuy: Franco, escrow program and backend. Ignacio, eSIM connectivity. Daniel, metering and the interviews. Joel, the app. We live next to the border. We are the traveler." |
| 1:47–2:00 | Next milestone and close | "Next: ten real trips with Argentine travelers, a Squads multisig, then mainnet. AstroAm. Travel connected. Pay only for what you use." |

## Recording checklist

1. Record facing the camera, with even light and a quiet room. The face goes in a column on the left of the final video, so frame head and shoulders with some space around them.
2. Record each block as its own take, or the whole pitch in one take with a short pause between blocks. Pauses make it easier to line the voice up with the scenes.
3. If a block runs long, cut words, not the animation. The final cut must be 2:00 or less.
4. Render the animation: `node render.mjs video promo.mp4` (see [README](README.md)).
5. Mix, add burned-in English subtitles, replace `docs/demo/AstroAm-pitch-EN.mp4`, upload to Vimeo as public, open the link in a private window, and update Colosseum, Superteam Earn, and the chapter form.
