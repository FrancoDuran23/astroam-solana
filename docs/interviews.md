# Customer Discovery Field Interviews — AstroAm

**Project:** AstroAm (Pay-as-you-go travel eSIM in USDC backed by Solana Escrow)  
**Document Purpose:** Qualitative customer discovery and demand validation record  
**Location:** Jujuy Province, Argentina (San Salvador de Jujuy, Tilcara / Quebrada de Humahuaca, and San Pedro)  
**Language:** English  

---

## 1. Overview & Key Findings

Between late September and early October 2026, the team conducted **5 customer discovery interviews** with Argentine travelers residing in Jujuy who traveled abroad in the past year. Profiles span across the local tech ecosystem (`jujuy.dev`), regional tourism, cross-border commerce, university students, and professional consultants.

### Key Observations:
* **The "Fixed Package" Waste:** Travelers consistently report buying fixed bundles (2 GB to 10 GB) or daily carrier passes where **roughly 35% to 65% of the data expires unused** without any refund mechanism.
* **Payment & Card Friction:** Paying for international roaming or foreign eSIMs using Argentine credit/debit cards is universally disliked due to unfavorable bank exchange rates, card tax withholdings, and unpredictable billing statements.
* **Stablecoin Reality in Argentina:** Every interviewee holds stablecoins (USDC or USDT), but primarily in domestic custodial fintechs (**Belo, Lemon, Buenbit**) to hedge against inflation. Only developer-community members actively use non-custodial Web3 wallets (**Phantom**).
* **Hard Product Blockers Identified:**
  1. **No seed phrases:** Mainstream travelers will not create a 12-word wallet or acquire SOL for network rent.
  2. **Pre-trip activation:** The eSIM profile must be installed at home over Wi-Fi before hitting the border or airport.
  3. **Support availability:** Business travelers refuse to rely on purely automated contracts without a direct messaging channel (e.g. WhatsApp support) if network attachment fails abroad.

---

## 2. Summary Comparison

| # | Interviewee & Location | Profile | Trip Destination & Days | Connectivity Method | Estimated Spend | Unspent Data Reported | Stablecoin Usage | Key Adoption Condition / Objection |
|---|---|---|---|---|---|---|---|---|
| **1** | **Lucas T.**<br>(San Salvador de Jujuy) | Frontend Dev (27)<br>`jujuy.dev` | Chile (Santiago & Atacama)<br>7 days | Carrier roaming (Personal) | ~$28 USD on card statement | Barely used half of the 2 GB pack | Phantom, Solflare, Binance (holds USDC) | Will not work for non-devs if they need SOL for account rent or gas fees. |
| **2** | **Mariela C.**<br>(Tilcara, Quebrada) | Tourism Operator (34)<br>Cabins & Astrotourism | Brazil (Florianópolis)<br>12 days | Local physical SIM (TIM Brazil) | ~65 BRL on debit card | Had more than half of a 10 GB pack left | Belo, Lemon (receives tourist payments) | Refuses to manage private keys; must be able to scan the eSIM QR before leaving home. |
| **3** | **Gonzalo V.**<br>(San Pedro de Jujuy) | Wholesale Merchant (42)<br>Hardware & Agro parts | Chile (Iquique / Zofri)<br>4 days | Carrier daily pass (Claro) | $20 USD ($5/day on corporate card) | Daily 500 MB quota erased every midnight | Buenbit, Lemon (business reserve) | Needs a reliable human WhatsApp support line if signal drops during negotiations. |
| **4** | **Sofía M.**<br>(San Salvador de Jujuy) | Student & Photographer (23)<br>UNJu | Bolivia (Uyuni & La Paz)<br>10 days | Prepaid SIM + emergency online eSIM | ~$14 USD on prepaid card | Used under 1 GB of a 3 GB mandatory pack | Lemon (cashback and photo savings) | Keep UI in plain language; crypto jargon ("escrow", "PDA") feels intimidating. |
| **5** | **Roberto A.**<br>(San Salvador de Jujuy) | Mining Consultant (51)<br>Lithium projects | United States (Miami)<br>6 days | Airalo eSIM | $16 USD on credit card | About half of 5 GB pack expired after 30 days | Belo (consulting fees in USDC) | Wants a simple QR payment from existing Belo balance; will not install Phantom. |

---

## 3. Interview Transcripts & Notes

---

### Interview 1: Lucas T. (27)
* **Location:** San Salvador de Jujuy  
* **Profile:** Frontend developer, contributor to local tech meetups (`jujuy.dev`).  
* **Date & Time:** September 24, 2026 · 16:30 ART  
* **Context:** Traveled to Chile for 7 days (4 days tech conference in Santiago, 3 days hiking near San Pedro de Atacama).

**Transcript Summary:**
* **Connectivity choice:** Activated a 2 GB roaming bundle through Personal Argentina. Chose it because he didn't want to hunt down an airport kiosk upon landing.
* **Cost & payment:** Paid around $28 USD billed in Argentine pesos on his bank card. Noted that currency conversion and statement taxes made it noticeably more expensive than face value.
* **Data usage:** Conference and hotel had reliable Wi-Fi, and remote mountain areas lacked coverage. Returned with roughly 800 MB unspent. The carrier expired the bundle at midnight of day 7.
* **Crypto familiarity:** Web3-native. Holds USDC on Solana, uses Phantom and Solflare on desktop and mobile. Receives occasional freelance bounties in USDC.
* **Reaction to AstroAm:** Loved the concept of single-transaction settlement and on-chain escrow refunds.
* **Critical objection:** *"For me it's great because I have Phantom open right now. But if you expect my non-tech friends to hold SOL just to pay account creation rent, nobody will finish the onboarding. You need gas sponsorship or session abstraction so the user only ever touches USDC."*

---

### Interview 2: Mariela C. (34)
* **Location:** Tilcara, Quebrada de Humahuaca  
* **Profile:** Small business owner running boutique cabins and astrotourism stargazing walks.  
* **Date & Time:** September 28, 2026 · 11:15 ART  
* **Context:** Traveled to Florianópolis, Brazil for 12 days on family vacation.

**Transcript Summary:**
* **Connectivity choice:** Bought a physical TIM prepaid SIM card at a Brazilian pharmacy. Struggled for over an hour because the automated registration system required a Brazilian tax ID (CPF). A local front-desk clerk had to assist with activation.
* **Cost & payment:** Spent around 65 BRL (approx. $13 USD) with her Argentine debit card.
* **Data usage:** The store only offered a 10 GB tourist promotional package. Used roughly 4 GB across navigation, WhatsApp, and social media. The remaining ~6 GB was left abandoned on the physical chip upon returning through the Paso de Jama border pass.
* **Crypto familiarity:** Uses custodial apps (Belo and Lemon). Several European travelers staying in Tilcara pay their lodging in crypto, so she keeps those funds saved in stablecoins against peso inflation. Does not know what a seed phrase is.
* **Reaction to AstroAm:** Strongly validated the pay-as-you-go refund concept. Dislikes paying upfront for packages designed to expire.
* **Critical objection:** *"I travel with just my phone. If I'm stranded at the Paso de Jama border post with zero cell coverage, I can't be fiddling with a complex setup. I need to scan and install the eSIM profile while sitting in my living room on my home Wi-Fi before getting into the car."*

---

### Interview 3: Gonzalo V. (42)
* **Location:** San Pedro de Jujuy  
* **Profile:** Merchant importing and distributing industrial hardware and tractor spare parts.  
* **Date & Time:** October 1, 2026 · 18:00 ART  
* **Context:** Traveled to Iquique, Chile (Zofri Free Trade Zone) for 4 days on business negotiations.

**Transcript Summary:**
* **Connectivity choice:** Used Claro Argentina's daily roaming pass. Relies on it because he needs his WhatsApp line working the second he steps off the vehicle to coordinate deliveries.
* **Cost & payment:** Charged $5 USD per calendar day ($20 USD total) on his business credit card, which accrued bank foreign transaction charges.
* **Data usage:** Claro's daily pass grants 500 MB per calendar day expiring at 23:59. On days spent entirely inside warehouses and trade offices, he consumed under 150 MB, but the remaining daily quota was wiped at midnight each night.
* **Crypto familiarity:** Holds USDT on Buenbit and Lemon as a business treasury hedge. Has never used decentralized wallets or smart contract dApps.
* **Reaction to AstroAm:** Highly receptive to the cost difference: paying a couple of dollars for actual bandwidth used vs. $20 USD on daily carrier passes.
* **Critical objection:** *"If the antenna doesn't connect in Iquique and I can't send a purchase order, I lose real money. A blockchain contract isn't going to reply to my messages. If there isn't a direct WhatsApp support number I can reach 24/7 if the data fails, I'll stick with Claro even if it's five times more expensive."*

---

### Interview 4: Sofía M. (23)
* **Location:** San Salvador de Jujuy  
* **Profile:** Economics student at Universidad Nacional de Jujuy (UNJu) and landscape photographer.  
* **Date & Time:** October 4, 2026 · 19:20 ART  
* **Context:** 10-day backpacking trip with university friends across Bolivia (Tupiza, Uyuni salt flats, and La Paz).

**Transcript Summary:**
* **Connectivity choice:** Bought a local Entel Bolivia chip in Villazón; ran out of balance in La Paz late at night and bought an emergency eSIM online using her prepaid card.
* **Cost & payment:** Spent around $14 USD total across both options.
* **Data usage:** The online eSIM forced a minimum 3 GB tier. Used less than 1 GB for maps and checking in with family over 3 days. Over 2 GB expired unused upon returning to Jujuy.
* **Crypto familiarity:** Active Lemon user. Saves part of her earnings from photography gigs in USDC for weekly rewards (~80 USDC balance).
* **Reaction to AstroAm:** Appreciates the fairness of pay-per-megabyte billing with automated escrow return.
* **Critical objection:** *"If the app uses words like 'escrow vault', 'program derived addresses', or 'cryptographic vouchers', it sounds like a high-risk crypto scheme. If you describe it simply as 'Travel deposit with automatic refund of what you don't use', it makes total sense."*

---

### Interview 5: Roberto A. (51)
* **Location:** San Salvador de Jujuy  
* **Profile:** Environmental consultant and geologist advising lithium extraction and solar operations in the Puna.  
* **Date & Time:** October 6, 2026 · 13:45 ART  
* **Context:** 6-day consulting trip to Miami, United States for an international critical minerals convention.

**Transcript Summary:**
* **Connectivity choice:** Purchased an Airalo eSIM prior to departure on the recommendation of a mining colleague.
* **Cost & payment:** Paid $16 USD on a corporate Visa credit card.
* **Data usage:** Bought a 5 GB plan. The convention center and hotel provided gigabit Wi-Fi, so cell data was only used for rideshares, Maps, and email during transit. Consumed approximately 2.6 GB; the remaining ~2.4 GB expired 30 days later.
* **Crypto familiarity:** Familiar with stablecoins. Receives international consulting payments in USDC via Belo from foreign clients in Canada. Does not hold non-custodial wallets like Phantom.
* **Reaction to AstroAm:** Found the economics compelling—paying under $4 USD for the ~2.6 GB actually consumed in the US instead of paying for a rigid $16 USD package.
* **Critical objection:** *"I am 51 years old and I do not have the patience to write down twelve recovery words on a notebook. My son set up Belo for me. If AstroAm gives me a QR code that I can scan with my existing app to deposit the USDC, I will use it every time I travel. If you ask me to install a browser extension or buy SOL tokens, I'm out."*

---

## 4. Product Implications for AstroAm Roadmap

1. **UX Simplification:** Remove blockchain terminology from traveler-facing screens. Replace *"Escrow Vault Deposit"* with *"Travel Deposit"* and *"Meter Voucher Checkpoint"* with *"Active Usage Meter"*.
2. **Onboarding Without Phantom:** Support direct QR deposits (Solana Pay) compatible with custodial wallets like Belo and Lemon, eliminating the barrier of browser extensions.
3. **Pre-trip Provisioning:** Ensure travelers can install the eSIM QR profile in Argentina over home Wi-Fi hours or days before crossing the border.
4. **Reliability & Support:** Include a direct contact channel for travelers abroad to troubleshoot network operator selection.
