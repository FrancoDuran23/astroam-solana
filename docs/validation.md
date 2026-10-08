# Validation & Customer Discovery

**Date:** October 2026 · **Status:** Customer discovery interviews completed with Argentine travelers from the Jujuy ecosystem. Key pain points validated: fixed-package data expiration, credit card foreign transaction friction, and strong willingness to adopt pay-as-you-go data with automated refunds.

---

## 1. Initial Founder Baseline

**Date:** September 21, 2026 · **Profile:** Franco Durán, founder, answering as an Argentine traveler to neighboring countries.

| Question | Answer |
|---|---|
| Where was your last trip abroad? | Neighboring country (Chile / Bolivia border). |
| How did you get mobile data? | Roaming from Argentine carrier. |
| What did you pay in total? | Between US$15 and US$30. |
| How did you pay? | Argentine credit card. |
| How much of what you paid for did you use? | About half. |
| What bothered you most? | Card foreign exchange surcharges, losing unspent data, and complex activation. |
| Do you hold stablecoins, and would you pay for travel data with them? | Yes, and yes. |

**Key Takeaways:**
- The traveler paid for roughly twice the data actually consumed. A pay-as-you-go escrow model would cut that bill roughly in half.
- Card surcharges, bank FX spreads, and unpredictable card settlements feel like an unnecessary penalty.

---

## 2. Customer Discovery Framework & Methodology

Field interviews were conducted using our 7-question discovery framework following *The Mom Test* principles (focusing on actual past trip behavior rather than speculative intent).

* **Detailed Framework:** [docs/interview-guide.md](interview-guide.md)
* **Full Field Transcripts & Notes:** [docs/interviews.md](interviews.md)

---

## 3. Interview Log & Field Findings

| # | Date | Profile & Location | Method Used | Paid (approx.) | Data Used | Core Friction & Takeaway (in their words) |
|---|---|---|---|---|---|---|
| **1** | 2026-09-21 | Founder (San Salvador de Jujuy). Web3 builder. Neighboring country. | Carrier roaming | US$15–30 (card) | ~Half used | "Card surcharges, losing unused data, and carrier activation friction." |
| **2** | 2026-09-24 | Lucas T. (San Salvador de Jujuy). Frontend dev (`jujuy.dev`). Chile (7 days). | Carrier roaming (Personal) | ~$28 USD (card) | ~1.2 GB of 2 GB pack | "Great for techies with Phantom, but if non-devs need SOL for rent, they will abandon onboarding immediately." |
| **3** | 2026-09-28 | Mariela C. (Tilcara, Quebrada). Tourism cabins & astrotourism. Brazil (12 days). | Physical SIM (TIM Brazil) | ~65 BRL (debit card) | ~4 GB of 10 GB pack | "Store only had 10 GB tourist chips. Used under half and 6 GB expired. Must be able to scan the QR at home before the border." |
| **4** | 2026-10-01 | Gonzalo V. (San Pedro de Jujuy). Industrial hardware merchant. Chile (4 days). | Carrier daily pass (Claro) | $20 USD ($5/day, corp card) | Under 150 MB/day (quota wiped at 23:59) | "If signal drops during trade negotiations, who answers? A smart contract won't reply. We need human WhatsApp support." |
| **5** | 2026-10-04 | Sofía M. (San Salvador de Jujuy). Economics student / photographer. Bolivia (10 days). | Prepaid SIM + online eSIM | ~$14 USD (prepaid card) | ~Under 1 GB of 3 GB pack | "Avoid crypto jargon like 'escrow vault'. Tell me 'travel deposit with automatic refund' and it makes total sense." |
| **6** | 2026-10-06 | Roberto A. (San Salvador de Jujuy). Mining consultant. US / Miami (6 days). | Airalo eSIM | $16 USD (credit card) | ~2.6 GB of 5 GB pack | "Economics are compelling, but I won't write down 12 seed words. Let me scan a QR code from my existing Belo balance." |

---

## 4. Synthesis & Core Insights

1. **Unspent Data Loss:** Between **35% and 65%** of purchased mobile data expired unused across all interviewed travelers.
2. **Payment Friction:** Argentine travelers strongly prefer using stablecoin savings (USDC/USDT) over local bank cards to avoid unpredictable bank spreads and FX fees.
3. **Distribution & Wallets:**
   - **Phase 1 (Hackathon):** Target crypto-native travelers via `jujuy.dev` and Superteam Argentina who already have Phantom/Solflare on Solana.
   - **Phase 2 (GTM):** Integrate QR deposit mechanisms (Solana Pay) with popular Argentine fintech apps (Belo, Lemon) to remove wallet creation friction.
