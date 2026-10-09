# AstroAm

Prepaid travel data: you lock USDC on Solana, pay only for what a meter attests, and the rest comes back to your wallet.

Demo for Colosseum / Superteam Argentina. Deadline: Sunday 11 October 2026, 23:59 ART. The traveler app started from the Stellar build ([FrancoDuran23/stellar_jujuy_dev@a19ed4d](https://github.com/FrancoDuran23/stellar_jujuy_dev/tree/a19ed4d)). The Soroban channel is not the payment path of this demo.

## Video pitch

https://github.com/user-attachments/assets/138192e6-7086-4dc6-8f38-9438cfea96cb

[`docs/demo/AstroAm-pitch-EN.mp4`](docs/demo/AstroAm-pitch-EN.mp4) (2:00). The animation is rendered from [`docs/demo/promo`](docs/demo/promo/README.md).

## Problem

Roaming plans are sold in big blocks. A weekend trip still pays for a week or a pile of gigabytes, and the unused part expires. The bill shows up later.

## Solution

You pick a country and a USDC budget. One wallet transaction deposits Circle devnet USDC into an escrow the program owns. Usage is measured off-chain. AstroAm's meter key signs a running total. One close pays that total to AstroAm and sends the remainder back. If nobody closes, a timeout does the same split after 7 days.

The eSIM screen in this demo is a sample profile. A live carrier is not connected.

The native program in `programs/astroam-escrow` does not debit per megabyte:

1. **deposit** — the traveler puts USDC in the escrow vault. The same transaction can register a session key. That key does not sign vouchers.
2. Usage is measured off-chain. The **meter key** stored in the program config signs one cumulative voucher, ed25519 over `(program id, escrow id, cumulative amount)`. The traveler and the session key cannot sign it.
3. **checkpoint** — writes the latest meter voucher on the escrow. No USDC moves, and the timeout clock does not restart.
4. **claim** — pays the payee the part of the voucher that is not paid yet, and leaves the escrow open. This restarts the timeout.
5. **close** — requires a meter voucher between what was already attested and the deposit. Pays the rest to the payee and refunds what remains, in the same transaction.
6. **refund** — `SOLANA_TIMEOUT_SECONDS` (7 days by default) after the deposit, the last top-up, or the last claim, pays the payee the attested amount that was not collected and returns only the rest to the traveler. A checkpoint does not move that deadline.
7. **topUp** — the same traveler can add USDC before close.

Anyone can send checkpoint, claim, close, and refund. The meter signature sets the amount. The destination is the configured payee or the traveler. The charge never exceeds the deposit.

## Why Solana

The escrow is the product, and four things in it depend on Solana. It is not a payment rail that another chain could replace.

1. **The chain checks the voucher, in the same transaction that pays.** `checkpoint`, `claim` and `close` each follow an ed25519 verification of the meter's signature. Solana's ed25519 precompile checks the signature and the program reads the signed message and the signer from the instructions sysvar. No oracle contract and no off-chain relayer sits in between. A checkpoint used 4,734 compute units on devnet.
2. **A vault the program owns, holding Circle's own USDC.** The traveler's USDC sits in an SPL Token account owned by that trip's escrow PDA. Paying AstroAm and refunding the traveler are two token transfers inside one `close`: both happen or neither does. The USDC is native, issued by Circle on Solana, not a bridged copy.
3. **Fees far smaller than what is being sold.** Usage is collected in tranches of a few dollars, so every trip is several transactions. The devnet run below (one deposit, three checkpoints, two claims, one close) paid **65,000 lamports in fees in total, 0.000065 SOL**. That is under one US cent at any SOL price below $150.
4. **The refund lands while the traveler is still looking at the screen.** Those seven transactions went from deposit to close in 77 seconds, with the steps run by hand.

| Transaction (2026-10-07 devnet run) | Fee (lamports) | Compute units |
|---|---|---|
| Deposit | 5,000 | 19,977 |
| Checkpoint × 3 | 10,000 each | 4,733 to 4,734 |
| Claim × 2 | 10,000 each | 13,508 and 22,587 |
| Close | 10,000 | 18,128 |
| **Total** | **65,000** | |

Figures read from `getTransaction` on `https://api.devnet.solana.com` for the signatures listed under [Live on devnet](#live-on-devnet).

One cost is not solved yet. The deposit also took 0.0028 SOL from the traveler's wallet to create the escrow and vault accounts, and the program does not close those accounts at `close`, so that amount stays locked. Returning it at close is on the [roadmap](#roadmap).

`src/rails/PaymentRail.ts` is what is left of the app's first build on Stellar. It only keeps the demo's in-memory metering. The Solana escrow does not go through it: the program is in `programs/astroam-escrow`, the backend's transactions in `src/solana`, and the wallet's in `frontend/src/chain`.

### Why devnet

Colosseum reviews products on Solana devnet. That is the cluster Phantom can point at, and the one with a public faucet and Circle's devnet USDC. A local validator is invisible to a judge's wallet. Solana testnet is a different cluster and does not have this USDC mint. Mainnet is out of scope.

USDC mint (Circle, 6 decimals, SPL Token): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

[Circle's address list](https://developers.circle.com/stablecoins/usdc-contract-addresses)

`getAccountInfo` on `https://api.devnet.solana.com` returned an 82-byte account owned by `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (classic SPL Token, not Token-2022). Byte 44 (decimals) is 6 and byte 45 (initialized) is 1. The mint account does not store the symbol; Circle documents this mint as USDC. The program rejects a mint that does not have 6 decimals.

The base app's meter counts in 7-decimal raw units (1 raw = 1e-7 USDC). That number is not sent on-chain. 5 USDC is `5_000_000` atomic units, not `50_000_000`.

## Live devnet program

This escrow **is deployed** on Solana devnet. `npm run solana:deploy` printed program id `HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk`. Its config (`4igZjvwU4sfiu4dsRAzcyk2PqQGBgZqhJ8ddnczXpy3o`, 106 bytes) stores:

| Field | Value |
|---|---|
| Payee and upgrade authority (the deployer) | `9NMAvdKGJibTUFW4mWRfVd4sZRpLNo3fQCQMqdrXXV89` |
| Meter key | `3WqaNhVVCCnabBLGA9YWviQHDvo6fTmX1Y9otcmsdB7k` |
| Mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle USDC) |
| Timeout | 604800 s (7 days) |

| Account or transaction | Solana Explorer (devnet) |
|---|---|
| Program | [HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk](https://explorer.solana.com/address/HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk?cluster=devnet) |
| Config | [4igZjvwU4sfiu4dsRAzcyk2PqQGBgZqhJ8ddnczXpy3o](https://explorer.solana.com/address/4igZjvwU4sfiu4dsRAzcyk2PqQGBgZqhJ8ddnczXpy3o?cluster=devnet) |
| Initialize | [5sCmauno…bk8h5Gxp](https://explorer.solana.com/tx/5sCmaunoJLppYh6wgzcbY3hmCD9w52HuK9D8HYLWzPpKdrqxotM3fzW4gRXds5jZWNWov4xYpxzttkoZbk8h5Gxp?cluster=devnet) |
| Latest program deploy | [3jqc3Z5m…gmGXpqs](https://explorer.solana.com/tx/3jqc3Z5mLvPeyg3bj81TnTbbNamBAEfbYu6c8QxVj9nV7TQsymy3CTWF4W2BdPwjaxBJSRpotyrxayjizgmGXpqs?cluster=devnet) |

Those public addresses are in `.env.example`. With `cp .env.example .env`, the Phantom or Solflare deposit button sends USDC to this program. Only the meter key can sign the voucher that allows a close, so automatic close, checkpoint, and claim run only on an API that has `SOLANA_METER_KEYPAIR` (and `SOLANA_OPERATOR_KEYPAIR` to send them). Without that key, a deposit still works. The timeout refund releases it later.

### Live on devnet

One end-to-end run on this program, 2026-10-07 17:39–17:41 UTC. Signatures come from `getSignaturesForAddress` on `HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk`. The traveler (`C1pGjANXS6wN28nuririx4MymgCDGPuydqjsUQqa7KZ2`) signed only the deposit. The payee key signed the checkpoints, the claims, and the close.

The deposit was 2.5 USDC. Three checkpoints attested 0.625, then 1.25, then 1.875 USDC. Two claims paid the payee 0.625 and then 1.25 (1.875 in total). The close returned the remaining 0.625 USDC to the traveler.

| Step | Solana Explorer (devnet) |
|---|---|
| Program | [HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk](https://explorer.solana.com/address/HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk?cluster=devnet) |
| Config | [4igZjvwU4sfiu4dsRAzcyk2PqQGBgZqhJ8ddnczXpy3o](https://explorer.solana.com/address/4igZjvwU4sfiu4dsRAzcyk2PqQGBgZqhJ8ddnczXpy3o?cluster=devnet) |
| Deposit, 2.5 USDC | [3XsX6Q3i…4BbTAxU](https://explorer.solana.com/tx/3XsX6Q3i2JLq1GTZdsv1SUyUmoM37R8whLmAz9AcQ76VwwGaW2sQUJ2FrRkJi1pCU4n5BiYAv9Ue4z6nZ4BbTAxU?cluster=devnet) |
| Checkpoint, attested 0.625 | [3PipJ4BJ…weUuf22](https://explorer.solana.com/tx/3PipJ4BJemMX8YVRyDwirttRmNHZZWC19iDZg7fvScYKNdYf4TFXDZmMu3STwr44re5MYx4FZv2G1u8PXweUuf22?cluster=devnet) |
| Claim, 0.625 to the payee | [5AjKgHFa…8ajhZpU](https://explorer.solana.com/tx/5AjKgHFaiDKo7t3WC53Wc6v413aUkgrpJ2d71i7jBwWZmjU298tPohpaudW5bcaEZHTRdhTsthki5ZBrk8ajhZpU?cluster=devnet) |
| Checkpoint, attested 1.25 | [3i46A5dC…D6Cu8Tv](https://explorer.solana.com/tx/3i46A5dCRVeySLchrCZG1euAig6sn7wJTTVWZ9pkcJQmFvZprqxjNdE5rTwbSZbJiu5iwLYozysMafoLPD6Cu8Tv?cluster=devnet) |
| Checkpoint, attested 1.875 | [5tajJ5EE…fcoszz](https://explorer.solana.com/tx/5tajJ5EEwt4GUTSCvpJJFci6Lbj6LaUPbt9977qemYgas3zcgkBWvfy3JL3i8cstQv2z2gPsTJ2kit34afcoszz?cluster=devnet) |
| Claim, 1.25 to the payee | [3qYhLhiQ…AAb7b6f](https://explorer.solana.com/tx/3qYhLhiQdX84om8KQ44j8EzchQFLhdt4wdEiPdytzkwGUR6xiGq9D17dPeRri8KvFwKrVsrKLhMnFHBF3AAb7b6f?cluster=devnet) |
| Close, 0.625 back to the traveler | [64ekDSSP…36cG3W8](https://explorer.solana.com/tx/64ekDSSP1CiGpoRb4zf65AgV4XU1rFgTfCu5oVX2UFR98qoZ3toKVn6i7rHDTGCbp4AGp51mti6dfUgeM36cG3W8?cluster=devnet) |

The config grew to 106 bytes to store the meter key, so the first program, at `8QXPo6yVxZuC3goYzHVLsxVkE1J6BaEqZvfW9e3Do2uq`, could not take this code with `--upgrade`. [That first program](https://explorer.solana.com/address/8QXPo6yVxZuC3goYzHVLsxVkE1J6BaEqZvfW9e3Do2uq?cluster=devnet) stays on devnet (payee `GmqSpjbis6DZV4easxKdPpRZmhx7RBoDJDsFB2psnYDx`, no meter key). Its deploy was `4APAdDDXSVWkkuqWSmhwJvB7GZDoqbtqZcEivqjsNJCYGFUNQEvsRRYM2ctxzrAVohbxrk4v5pVUSbygvmNZSiMq` and its initialize was `3QdiV1oBvnbXEFDzdi43LVEED6dgGmnadwjtkti9D2mscwoPVqqx2Zk81aBfCVsLCEbXbeefdFrZwgnJNXSJJNy7`. Its escrows can still close and refund. `.env.example` does not point at it.

The private keys (`id.json` for the deployer, `meter.json` for the meter, and the program keypair under `programs/astroam-escrow/target/deploy/`) are not in the repo and will not be. Whoever has them should keep a backup off the machine. Without `id.json` you cannot upgrade the program or move collected USDC. Without `meter.json` the API cannot sign vouchers for this program.

## Architecture

```
wallet (Phantom or Wallet Standard)
  → deposit USDC into the escrow vault (one transaction)
meter key (off-chain)
  → signs the cumulative usage voucher
backend
  → checkpoint / claim / close, or the wallet submits them
program
  → pays the payee the attested amount, refunds the rest
```

The eSIM provider is behind `CONNECTIVITY_PROVIDER`. The default is `fake` (a sample profile in memory). `citrus` exists in the code and stays off unless that env var is set. This demo does not call it.

### Team & roles

Team of four, based in Jujuy, Argentina, working full-time remote.

| Name | GitHub | Role | Main areas |
|---|---|---|---|
| Franco Agustín Durán (founder) | [@FrancoDuran23](https://github.com/FrancoDuran23) | Escrow program, payments backend, and frontend | Solana escrow (`programs/astroam-escrow`, deploy and fund flow); payments channel and vouchers on Stellar; contract and UI on Monad |
| Ignacio Martín | [@ignaMartin22](https://github.com/ignaMartin22) | Connectivity (eSIM) and escrow contracts | Citrus/Telnyx, usage and webhooks on Stellar; escrow `claim` and refunds on Monad. The Solana meter-key close and the timeout that pays the attested amount are in this program |
| Daniel Palermo | [@DanielPalermoo](https://github.com/DanielPalermoo) | Backend and metering | Traffic meter, Soroban adapter, and CosmoPay gateway (Stellar build) |
| Joel | [@Joel010999](https://github.com/Joel010999) | Frontend | Traveler app, mobile, eSIM flow in the UI, and product API (Stellar build) |

### Custody and trust model

This is what `programs/astroam-escrow` does on devnet program `HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk`. A Squads multisig, a frozen upgrade authority, and a timelock are planned below. None of them is deployed.

**Where the USDC sits.** `deposit` opens two accounts for that trip. The escrow PDA (`["escrow", escrow id]`) is owned by the program and stores the traveler. The vault PDA (`["vault", escrow id]`) is the SPL token account that holds the USDC. The Token program owns the vault account. Its token authority is the escrow PDA, and the program signs transfers out as that PDA. The deposit credits that vault. It does not credit a team wallet.

**Who signs.** `deposit` and `topUp` require the traveler's signature. `checkpoint`, `claim`, `close`, and `refund` accept any fee payer, so the traveler cannot block settlement by withholding a signature. The session key stored at deposit is never checked. For `checkpoint`, `claim`, and `close`, the previous instruction must be an ed25519 verification of `AstroAmEscrow:v1:close || program id || escrow id || amount`, signed by the meter pubkey stored at `initialize`. A voucher from the traveler, the session key, or the payee is rejected, so those keys cannot set the amount.

**What the meter can attest.** The cumulative amount must be at most the deposit and at least the amount already claimed. `close` also rejects an amount below the last checkpoint, so a later voucher cannot undercut one already recorded. `checkpoint` writes the amount, moves no USDC, and does not restart the timeout. The meter cannot name a recipient. `initialize` writes the payee and the meter once. No instruction changes either pubkey.

**Where a payout can go.** USDC leaves the vault only through these three instructions:

- `claim` sends `cumulative − claimed` to a token account owned by the configured payee, leaves the escrow open, and restarts the timeout.
- `close` sends `cumulative − claimed` to that payee and `deposit − cumulative` to the traveler, in the same transaction, then marks the escrow settled.
- `refund` runs only after `timeout` seconds from the last deposit, top-up, or claim (604800 seconds on this config, 7 days). It sends `attested − claimed` to the payee and `deposit − attested` to the traveler. It uses the attested amount already stored and takes no new voucher. A checkpoint does not move that deadline.

No instruction lends, stakes, or wraps the vault balance. The signed voucher message is in the checkpoint, claim, and close transactions, so the attested amount is on the explorer.

**What is still trusted.** Two powers sit outside those rules.

- The upgrade authority can replace the program. The limits above are the deployed code. A replacement could move the same vault under different rules, because the PDA signature belongs to the program id. That authority is stored on the program data account by the BPF upgradeable loader. The program config does not contain it.
- The meter key can sign a cumulative amount above the data actually used, up to the deposit. The program checks the signature and the cap. It does not read a carrier usage record.

The payee key receives USDC only after a voucher within that cap, or, on timeout, only `attested − claimed`. It has no instruction that pulls an arbitrary amount from a vault.

**Current keys on devnet.** One key, `9NMAvdKGJibTUFW4mWRfVd4sZRpLNo3fQCQMqdrXXV89`, is the payee in config `4igZjvwU4sfiu4dsRAzcyk2PqQGBgZqhJ8ddnczXpy3o` and the upgrade authority on the program data account. On the 2026-10-07 run that same key signed the checkpoints, the claims, and the close. The program has no operator field: any account with SOL can pay those fees. A separate meter key, `3WqaNhVVCCnabBLGA9YWviQHDvo6fTmX1Y9otcmsdB7k`, signs the vouchers. The private keys are held by a team member. Ignacio holds the deployer key. They are not in the repo.

The payee and the upgrade authority are still that one key, for three reasons:

- The 2026-10-07 redeploy and its `initialize` are signed by one keypair. The Squads multisig has not been created.
- The payee is fixed at `initialize`. There is no `set_payee` instruction, so a multisig payee means deploying again.
- A server cannot sign as a Squads multisig. Sweeping USDC already paid to the payee has to become a proposal the signers approve.

**Plan (not done).** None of the following is implemented.

- Move the upgrade authority and the payee to a Squads multisig, 2 of 3: Franco Durán, Ignacio Martín, and Daniel Palermo. Settled USDC would go from the payee to that multisig treasury. The treasury would fund the USD card that pays the eSIM provider. The multisig would hold the upgrade authority and would receive settled USDC. It would not be the vault's token authority. An upgrade could still change that.
- The treasury and offramp path is not running. It stays that way until the company entity exists.
- Escrows are not lent and earn no yield. The plan is to keep them that way.
- Before mainnet, consider freezing upgrades or adding a timelock.
- Rotate the meter key and keep it in a separate signer service, apart from the multisig. This program has no instruction that changes the meter, so a rotation needs a new deployment or an upgrade.

After a Squads vault exists, the upgrade authority moves with one command. The payee still needs a new deployment, or a sweep of USDC the current payee has already received:

```bash
# Planned. Not run. Upgrades would then require 2 of 3 signers.
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <SQUADS_VAULT> \
  --keypair <CURRENT_UPGRADE_AUTHORITY>

# No set_payee instruction. A new deployment points at the vault:
#   export SOLANA_PAYEE_ADDRESS=<SQUADS_VAULT>
#   npm run solana:deploy
# or sweep USDC already collected by the current payee to that vault.
```

**Why this is not custody of traveler funds.** This describes the program. It is not legal advice. While an escrow is open, the traveler's USDC is in that trip's vault, and the token authority is the escrow PDA. The program pays the configured payee only an attested amount up to the deposit, and returns the remainder to the traveler on `close` or, after the timeout, on `refund`. That balance is not lent and it earns no yield. What the key holders still have is the upgrade authority, which can change the program, and the meter key, which can over-attest up to the deposit. USDC already paid to the payee has left the vault. Moving the payee and the upgrade authority to the 2-of-3 multisig is planned and is not done. Whether a regulator would still treat any part of this as custody of third-party funds, including PSAV registration with the CNV in Argentina, is a legal question. This README does not answer it.

## Try it in 5 minutes

You need Node 22.18 or newer, Phantom (or another Wallet Standard wallet) on **Devnet**, a little devnet SOL, and Circle devnet USDC. You do not deploy a program. `.env.example` already points at the program above.

1. SOL for fees: [faucet.solana.com](https://faucet.solana.com) (`solana airdrop 2` when the public RPC allows it).
2. USDC: [faucet.circle.com](https://faucet.circle.com), Solana Devnet, mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
3. Start the API and the app:

   ```bash
   cp .env.example .env
   npm install
   npm run server                         # API on http://localhost:8080

   cd frontend && npm install && npm run dev   # app on http://localhost:5173
   ```

4. Do not create `frontend/.env`. Without `VITE_API_BASE_URL`, Vite forwards `/api` to the backend. Leave `ASTROAM_LIVE_ENABLED=false` and `CONNECTIVITY_PROVIDER=fake`. `PAYMENT_RAIL=fake` keeps demo metering in memory. USDC moves only when the wallet sends deposit, close, or refund.

5. Open the app, start a mission, and pay with the wallet. The USDC leaves your token account only when you approve the transaction. If both Phantom and Solflare are installed, the app uses Phantom first. Turn Phantom off to try Solflare.

`VITE_ASTROAM_MODE=demo` is a separate local mode with no chain. It is not the default. The default is `api`.

The traveler signs only the deposit. **Use 250 MB** and the close do not open the wallet. The close needs the meter key, which is not in this repo. **Refund after timeout** pays what was attested and returns the rest. Demo traffic stays on FakeProvider, as a sample profile. The live devnet run above is the one to judge: 2.5 USDC in, 1.875 USDC to the payee, 0.625 USDC back.

Publishing a public URL: [docs/deploy.md](docs/deploy.md).

## Test with your own deploy

To try a meter-signed close on devnet, the API needs the private meter key of that program. The key for the program above is not in the repo, so each teammate deploys their own copy, with their own deployer and their own meter. On devnet that costs nothing and shares no secret. The app in `.env.example` keeps pointing at `HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk`. Replace those addresses only in your local `.env`.

Without a deploy you can still run `npm test`, `npm run solana:test` (the whole program in `solana-program-test`, no keys), and the app with `VITE_ASTROAM_MODE=demo`.

1. Install the Solana CLI (Agave):

   ```bash
   sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
   ```

2. Point at devnet and create a key if you do not have one:

   ```bash
   solana config set --url devnet
   solana-keygen new -o ~/.config/solana/id.json
   ```

3. Devnet SOL for the deployer: [faucet.solana.com](https://faucet.solana.com) (`solana airdrop 2`).
4. The traveler wallet (Phantom or Solflare, on **Devnet**) needs SOL for the fee and Circle USDC at the mint above: [faucet.circle.com](https://faucet.circle.com).
5. Export the payee that receives used USDC (it can be the deployer):

   ```bash
   export SOLANA_PAYEE_ADDRESS=<base58 pubkey>
   solana-keygen new -o ~/.config/solana/meter.json
   export SOLANA_METER_KEYPAIR=~/.config/solana/meter.json
   # optional: export SOLANA_DEPLOYER_KEYPAIR=~/.config/solana/id.json
   # optional: export SOLANA_TIMEOUT_SECONDS=604800
   ```

6. From the repo root: `npm run solana:deploy`
7. Copy the `SOLANA_PROGRAM_ID=`, `SOLANA_PAYEE_ADDRESS=`, and `SOLANA_METER_PUBKEY=` lines the script prints into your local `.env`, and leave `SOLANA_METER_KEYPAIR` pointing at the key file. Restart the API. Do not paste an address the script did not print. `npm run solana:upgrade` only works for a program whose config is already 106 bytes with the same meter.

Without the CLI or without SOL, `npm run solana:deploy` prints those steps and exits with code 1.

### On Windows: build and deploy from WSL

`cargo build-sbf` does not work well on native Windows. Build and deploy in Ubuntu (WSL). Keep the API and the frontend on Windows. Every command in this section runs **in the Ubuntu terminal** (`wsl`), not in PowerShell. If PowerShell says it does not recognize `solana-keygen`, you are in the wrong terminal.

1. Tools (once):

   ```bash
   sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev libudev-dev curl rsync
   curl https://sh.rustup.rs -sSf | sh -s -- -y && source ~/.cargo/env
   sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
   echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc && nvm install 22
   ```

   The Windows Node install does not work inside WSL. You need this one.

2. Keys, stored in the Windows folder so the API can read them later. Press Enter at `BIP39 Passphrase` (leave it empty):

   ```bash
   mkdir -p /mnt/c/Users/<user>/.config/solana
   solana-keygen new -o /mnt/c/Users/<user>/.config/solana/id.json     # deployer = payee = operator
   solana-keygen new -o /mnt/c/Users/<user>/.config/solana/meter.json  # meter, a different key
   solana config set --url devnet --keypair /mnt/c/Users/<user>/.config/solana/id.json
   solana airdrop 2    # or https://faucet.solana.com
   ```

3. A copy of the repo on the Linux disk. Building on `/mnt/c` fails with `Cannot allocate memory (os error 12)`:

   ```bash
   rsync -a --exclude node_modules --exclude target --exclude .git \
     /mnt/c/<path to the repo>/ ~/astroam/
   cd ~/astroam && npm install
   ```

4. Deploy:

   ```bash
   export CARGO_BUILD_JOBS=2    # 1 if memory runs out again
   export SOLANA_DEPLOYER_KEYPAIR=/mnt/c/Users/<user>/.config/solana/id.json
   export SOLANA_METER_KEYPAIR=/mnt/c/Users/<user>/.config/solana/meter.json
   npm run solana:deploy
   ```

   If it stops with `fetch failed` after the build, the program is already uploaded and initialize is missing. Run `export NODE_OPTIONS=--dns-result-order=ipv4first` and run `npm run solana:deploy` again. It uses the same keypair in `target/deploy/` and deploys to the same program id. Do not delete that folder.

On Linux or macOS, skip the copy and the `/mnt/c` paths. The steps under [Test with your own deploy](#test-with-your-own-deploy) are enough.

### Your `.env`

`cp .env.example .env`, then replace the three addresses with what **your** deploy printed:

```bash
SOLANA_PROGRAM_ID=<yours>
SOLANA_PAYEE_ADDRESS=<yours>
SOLANA_METER_PUBKEY=<yours>
SOLANA_ESCROW_SESSION_KEYS=true
SOLANA_METER_KEYPAIR=C:/Users/<user>/.config/solana/meter.json
SOLANA_OPERATOR_KEYPAIR=C:/Users/<user>/.config/solana/id.json
```

Key paths are absolute and use the format of the machine that runs the API (on Windows, `C:/...`, not the `/mnt/c/...` paths the script prints). The API does not expand `~`. To see a `claim` with demo traffic (250 MB is 0.625 USDC), lower `CLAIM_MIN_USDC` to `0.5`. `FUND_FLOW_INTERVAL_MS=15000` shortens the wait.

When `npm run server` starts, the log should say `fund flow is automatic`, not `operator key not loaded` or `meter key not loaded`. `http://localhost:8080/api/capabilities` shows your program id and `escrowAutomation: true`.

### The traveler's wallet

Phantom or Solflare on **Devnet**, with an account that is not your deployer: SOL from [faucet.solana.com](https://faucet.solana.com) and USDC from [faucet.circle.com](https://faucet.circle.com) (Solana Devnet). If both extensions are installed, the app uses Phantom first: turn it off to test Solflare. The traveler signs only the deposit. Neither **Use 250 MB** nor the close opens the wallet.

### Keys

`id.json`, `meter.json`, and `target/deploy/astroam_escrow-keypair.json` are not committed and are not pasted into a chat. Keep a backup off the machine. An operator key does not have to be the payee: any account with devnet SOL can send `checkpoint`, `claim`, and `close`. Only the sweep to Bridge needs the payee key.

## Automatic fund flow

Decision: [`docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md`](docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md). The traveler signs **once**, the deposit. After that:

| Step | Who | What it does |
|---|---|---|
| Vouchers | the backend | After each usage read, the meter key signs the cumulative voucher. `POST /api/missions/:id/attest` writes it on the escrow (`checkpoint`). No wallet popup. |
| Tranches | the backend | Funds the eSIM at most one tranche (`FUNDING_TRANCHE_CENTS`, $2.50) ahead of what the vouchers cover, and never more than the deposit pays. |
| Collection | the backend | When the unpaid voucher reaches `CLAIM_MIN_USDC`, it sends a `claim`. |
| Close | the backend | Sends `close` when the traveler ends the trip (`POST /api/missions/:id/settle`), the deposit is spent, the end date has passed, or one day remains before the escrow timeout. |
| Treasury | the backend | Sweeps collected USDC to `BRIDGE_LIQUIDATION_ADDRESS`. |

What AstroAm can lose is one tranche: without a new voucher it does not fund more, and a close cannot go below what was already collected or already attested.

That loop needs the meter key for the program you are running. For the program in `.env.example`, only the person who holds `meter.json` can turn it on. A teammate who does not have that file uses [Test with your own deploy](#test-with-your-own-deploy).

1. `SOLANA_METER_KEYPAIR=<file>` and `npm run solana:deploy`. Copy the `SOLANA_PROGRAM_ID` and `SOLANA_METER_PUBKEY` it prints into your local `.env`. With the meter key the API signs vouchers. The wallet approves the deposit and, if there is no operator key, the close transaction, without signing the amount.
2. `SOLANA_OPERATOR_KEYPAIR=<key file>` in `.env`. The backend reads each deposit from the escrow instead of trusting the request, runs the fund job every `FUND_FLOW_INTERVAL_MS`, and sends the `checkpoint`, the `claim`s, and the `close` itself. To sweep to Bridge, that key has to be the payee.

Without those variables the API cannot sign a voucher. The old program still rejects a close the traveler did not sign.

Still not in the code: open the Bridge account and create the liquidation address, set the card and auto-reload on the eSIM provider, and try the loop with a real eSIM. The meter-key program is already on devnet (above). If `solana program deploy` says the program account is too small, `solana program extend <program id> <bytes>` grows it.

What the eSIM provider allows, the architecture that results from it, and the options for the collected money: [docs/decisiones/fund-flow-architecture.md](docs/decisiones/fund-flow-architecture.md).

## Go-to-market and validation

Who buys, through which channel, at what price and margin: [docs/go-to-market.md](docs/go-to-market.md). Traveler interviews and customer discovery insights from Argentine travelers in Jujuy: [docs/validation.md](docs/validation.md) and [docs/interviews.md](docs/interviews.md) (7-question framework in [docs/interview-guide.md](docs/interview-guide.md)).

The USDC-per-GB figures below are the go-to-market rates: reseller cost of the cheapest network, times 1.5 (`MARKUP_BPS=15000`). Those costs were read on 7 October 2026. The card, roaming, and retail quotes were read on 8 October 2026, between 01:20 and 02:10 ART. The sample rates in the app (`pricePerMbUsdc`, Brazil 0.0025 USDC per MB) are examples for a demo with no live carrier. They are not this comparison.

### Target market

The first buyers are Argentine travelers going to a neighboring country: Chile, Brazil, Uruguay, Paraguay, or Bolivia. The buyer is the traveler, and they already hold USDC.

We launch with Argentina's neighbors (Chile, Brazil, Uruguay, Paraguay, Bolivia); expansion covers all 220 destinations our eSIM provider supports.

On the cheapest network the traveler pays **2.48 USDC/GB** in Chile, Brazil, and Uruguay, **2.76** in Bolivia, and **5.25** in Paraguay. Against the cheapest eSIM paid with an Argentine card in pesos, 30% percepción included, that rate is lower on every 1 GB pack in the table below, and lower on a fully used 5 GB pack in Chile, Brazil, Uruguay, and Bolivia. In Paraguay a fully used 5 GB pack is 6% cheaper than AstroAm, and a fully used 10 GB pack is 61% cheaper. When the traveler uses about half of a card pack, AstroAm's price per GB used stays the same, because the unused deposit is refunded, and the card pack's price per GB used doubles.

A later onboarding step, not built yet, would ask trip length and a usage profile and recommend the cheaper of two ways to pay. Light or uncertain usage (maps and messaging, or a trip whose usage is unclear) stays on pay-per-MB, and unused funds come back to the wallet. Heavy, predictable usage (video calls and streaming) can take a prepaid block of gigabytes at our eSIM provider's public retail rate, which is lower per GB. That block costs less once the traveler uses about **3.7 GB of a 5 GB block**, or about **7.4 GB of a 10 GB block**. The arithmetic is under [Smart plan selection](#smart-plan-selection-planned).

### Go-to-market / Sales channels

**Planned. Nothing here is running.** As of 8 October 2026 no terminal, agency, creator, or wallet company has been contacted, no QR is up, and no referral fee has been paid. The same plan is in [docs/go-to-market.md](docs/go-to-market.md).

These five are how AstroAm would reach an Argentine traveler leaving for Chile, Brazil, Uruguay, Paraguay, or Bolivia. CAC is cash spent on that channel divided by travelers who finish a deposit. Conversion is deposits divided by the scans, links, or referrals that channel produced. The pilot ask is still ten real trips in 60 days.

| Channel | Why it fits | Cost | How we would measure it |
|---|---|---|---|
| Point of departure | Bus terminals, border crossings, and airports on the Jujuy–Salta corridor are where people leave for Chile and Bolivia. A QR there is the deposit link at the moment they need data. Brazil, Uruguay, and Paraguay use the same QR with agencies and groups that sell those trips. | Printing, and permission to put a poster up. No site has agreed. | Scans to deposits. CAC = print cost / deposits. |
| Travel agencies and tour operators | They sell packages to the neighbor countries and talk to the traveler when the trip is booked. | No retainer. A referral fee in USDC, paid automatically from the per-GB margin, and only after a deposit. The fee is not set, and the automatic payment is not in the code. Gross margin before that fee is 0.83 USDC/GB in Chile, Brazil, and Uruguay, 0.92 in Bolivia, and 1.75 in Paraguay. On a first trip the $1.75 eSIM issue fee is still there. | Referrals to deposits. CAC = fees paid / deposits. |
| Crypto communities | Early adopters who already hold USDC and a Solana wallet. The founder runs [jujuy.dev](https://jujuy.dev.ar) and counts 430+ members. Superteam Argentina is the other room the team can post in. Membership is reach, not customers. | Time. No sponsorship and no deal. | Posts to deposits. Cash CAC is about zero. |
| Traveler groups and creators | Facebook and WhatsApp groups, and creators who post trips across the border, reach people who are not in a crypto community. | Time, or a creator fee if one is paid. No group and no creator is signed. | Link clicks to deposits. CAC = fees / deposits. |
| Wallet links | A Phantom or Solana Pay link is the deposit, including the one encoded in the QR and the referral. It does not need a wallet company to agree. Travelers who only have pesos still need a guide to get USDC. | Build time. No integration deal. Solana Pay is on the roadmap and is not built. | Links opened to deposits. |

### Pricing vs. what Argentine travelers pay today

We launch with Argentina's neighbors (Chile, Brazil, Uruguay, Paraguay, Bolivia); expansion covers all 220 destinations our eSIM provider supports.

The card column is the cheapest pack of that size among Airalo, Saily, Nomad, Roamless, and Ubigi (Ubigi checked for Brazil). List price in US dollars, times 2,002 / 1,539.01 (×1.3008): the dólar tarjeta (ARS 2,002, official rate plus the 30% percepción) converted at the MEP rate (ARS 1,539.01). Both rates are from Ámbito on 8 October 2026 at 00:06. "Lower" means AstroAm's USDC per GB is below that card price. "Higher" means it is above. At half use, the card figure is the whole pack price divided by half the gigabytes. AstroAm stays on its pay-per-MB rate, because the escrow refunds what was not used.

| Destination | AstroAm (USDC/GB) | Card eSIM, 1 GB (US$/GB) | vs 1 GB | Card eSIM, 5 GB (US$/GB) | vs 5 GB | 5 GB pack, half used (US$ per GB used) | AstroAm, half used (USDC per GB used) | vs half-used 5 GB |
|---|---|---|---|---|---|---|---|---|
| Chile | **2.48** | 5.79 | 57% lower | 3.64 | 32% lower | 7.28 | **2.48** | 66% lower |
| Brazil | **2.48** | 5.14 | 52% lower | 3.12 | 21% lower | 6.24 | **2.48** | 60% lower |
| Uruguay | **2.48** | 7.81 | 68% lower | 4.94 | 50% lower | 9.89 | **2.48** | 75% lower |
| Paraguay | **5.25** | 7.09 | 26% lower | 4.94 | 6% higher | 9.89 | **5.25** | 47% lower |
| Bolivia | **2.76** | 9.69 | 72% lower | 7.02 | 61% lower | 14.05 | **2.76** | 80% lower |

A fully used 10 GB card pack, same conversion: Chile and Uruguay US$3.25/GB (AstroAm 24% lower), Brazil US$2.47/GB (about the same: 24.80 USDC against US$24.72), Paraguay US$3.25/GB (AstroAm 61% higher), Bolivia US$4.55/GB (AstroAm 39% lower).

| Destination | Cheapest 1 GB pack | Cheapest 5 GB pack | Cheapest 10 GB pack |
|---|---|---|---|
| Chile | Roamless, US$4.45, 30 days | Nomad, US$14, 30 days | Nomad, US$25, 30 days |
| Brazil | Roamless, US$3.95, 30 days | Airalo, US$12, 7 days (Nomad is US$12 for 30 days) | Nomad, US$19, 30 days (Ubigi is the same price) |
| Uruguay | Nomad, US$6, 7 days | Nomad, US$19, 30 days | Nomad, US$25, 30 days |
| Paraguay | Roamless, US$5.45, 30 days | Nomad, US$19, 30 days | Nomad, US$25, 30 days |
| Bolivia | Roamless, US$7.45, 30 days | Airalo, US$27, 7 days | Airalo, US$35, 7 days |

The charge follows the network the phone uses (that network's cost × 1.5). The table is the cheapest network. In Brazil the go-to-market costs put Claro at 6.21 USDC/GB and TIM at 7.26. Public rates on 8 October 2026, times 1.35, put a dearer network near 6.91 USDC/GB in Chile, 7.26 in Brazil, 8.61 in Uruguay, and 6.22 in Paraguay. Bolivia's networks were the same price. On those dearer networks a fixed pack can cost less.

Three limits on the comparison:

- **Paying from a US dollar account** skips the 30% percepción, so the eSIM costs its list price. At list price, AstroAm is still lower on the small packs. It is higher in Brazil at 5 GB (US$2.40/GB) and at 10 GB (US$1.90/GB), and in Paraguay from 3 GB up (3 GB US$4.67, 5 GB US$3.80, 10 GB US$2.50, against 5.25). Chile and Uruguay at 10 GB are US$2.50/GB, about the same as 2.48.
- **Personal and Movistar roaming packs**, priced in pesos with IVA and converted at MEP, are often lower per GB when the traveler uses the whole pack. Personal's 5 GB / 15 day pack for Brazil, Paraguay, Uruguay, and Chile is ARS 15,000, US$1.95/GB, with the legal text valid from 21 September 2026 to 20 October 2026. Movistar's 3 GB / 7 day neighbors pack is ARS 10,800, US$2.34/GB, and it includes Bolivia. The published validity is 1–31 August 2026; the page was still up on 8 October 2026. Two of those Movistar packs, the documented way to cover 5 GB in Bolivia, are US$14.03, or US$2.81 per GB of the 5 GB, just above AstroAm's 2.76. Some Personal and Claro postpaid plans already include roaming in Mercosur and Chile, so the extra data charge on those plans is zero. At half use the Personal pack is US$3.90 per GB used and the Movistar 3 GB pack is US$4.68. AstroAm at 2.48, and Bolivia at 2.76, sit below those. Paraguay at 5.25 stays above Personal's US$3.90.
- **Our eSIM provider's own public retail price** is lower than AstroAm on the cheapest network: 1.84 US$/GB in Chile, Brazil, and Uruguay, 3.89 in Paraguay, and 2.05 in Bolivia. With the same 30% percepción that is about 2.39, 5.06, and 2.67 US$/GB, still under 2.48, 5.25, and 2.76. AstroAm's pay-per-MB rate is that retail price times 1.35 (reseller cost is 10% under retail, then `MARKUP_BPS=15000`).

What AstroAm adds is the refund. The traveler deposits USDC into a per-trip escrow, pays the megabytes the meter attests, and the unused balance returns to the wallet in the close. Airalo, Saily, and Holafly refund a plan that was never activated. Once the plan is activated, unused data is spent. Because of that, using half of a card pack doubles its cost per GB used, and AstroAm's cost per GB used does not change.

The $1.75 fee to issue an eSIM is not in these per-GB figures. Whether the first trip charges 1.75 USDC for it is not decided. Buying the USDC with pesos at the crypto rate (ARS 1,605.09) instead of MEP adds about 4.3%, and that is not in the table. VAT on digital services is not added: these sellers are not on ARCA's list. Provincial gross-income tax (about 2% in some provinces) is not added either. Impuesto PAIS ended on 23 December 2024. Airalo's gigabyte is 1,024 MB and these AstroAm rates use 1,000 MB. The gap is under 2.4% and is not adjusted. The provider's public site lists 220 destinations; its FAQ also says "200+ countries and territories." This note uses 220 destinations.

Sources, read on 8 October 2026 unless the line says otherwise:

- AstroAm USDC/GB: [docs/go-to-market.md](docs/go-to-market.md), reseller costs read 7 October 2026, traveler price = cost × 1.5.
- Exchange rates: [Ámbito, 8 October 2026](https://www.ambito.com/finanzas/dolar-hoy-cuanto-cotiza-este-jueves-8-octubre-n6331412). The 30% percepción is RG 5617/2024. Dólar tarjeta that day was published as the official rate plus 30%.
- Chile packs: [Roamless](https://roamless.com/esim/chile-esim), [Nomad](https://www.nomadesim.com/chile-eSIM). Also compared: [Airalo](https://www.airalo.com/chile-esim), [Saily](https://saily.com/esim-chile/).
- Brazil packs: [Roamless](https://roamless.com/esim/brazil-esim), [Airalo](https://www.airalo.com/brazil-esim), [Nomad](https://www.nomadesim.com/brazil-eSIM), [Ubigi](https://cellulardata.ubigi.com/rates-and-coverage/brazil-data-plans/). Also compared: [Saily](https://saily.com/esim-brazil/).
- Uruguay packs: [Nomad](https://www.nomadesim.com/uruguay-eSIM). Also compared: [Airalo](https://www.airalo.com/uruguay-esim), [Saily](https://saily.com/esim-uruguay/), [Roamless](https://roamless.com/esim/uruguay-esim).
- Paraguay packs: [Roamless](https://roamless.com/esim/paraguay-esim), [Nomad](https://www.nomadesim.com/paraguay-eSIM). Also compared: [Airalo](https://www.airalo.com/paraguay-esim), [Saily](https://saily.com/esim-paraguay/).
- Bolivia packs: [Roamless](https://roamless.com/esim/bolivia-esim), [Airalo](https://www.airalo.com/bolivia-esim). Also compared: [Nomad](https://www.nomadesim.com/bolivia-eSIM), [Saily](https://saily.com/esim-bolivia/).
- Unused-data terms: [Airalo](https://airalo.com/legal/terms-of-use), [Saily](https://support.saily.com/hc/en-us/articles/16420576170652-What-is-Saily-s-refund-policy), [Holafly](https://esim.holafly.com/refund-policy/).
- Personal roaming: [personal.com.ar/roaming](https://www.personal.com.ar/roaming). Movistar packs: [packs roaming pospago](https://www.movistar.com.ar/legales/roaming/packs-roaming-pospago). Claro included roaming: [Chile and Uruguay](https://www.claro.com.ar/personas/roaming/terminos-condiciones-chile-uruguay), [Brazil](https://www.claro.com.ar/personas/roaming/brasil).
- Public retail rates and the 220-destination count, on our eSIM provider's site: [home](https://citrusmobile.com/), [rates](https://citrusmobile.com/rates), [Chile](https://citrusmobile.com/chile), [Brazil](https://citrusmobile.com/brazil), [Uruguay](https://citrusmobile.com/uruguay), [Paraguay](https://citrusmobile.com/paraguay), [Bolivia](https://citrusmobile.com/bolivia).

### Smart plan selection (planned)

**Planned. Not implemented.** No screen, API, or provider call does this.

Onboarding would ask how long the trip is and which profile fits: maps and messaging, social, or video calls and streaming. From that it would estimate gigabytes and recommend the cheaper option.

- **Pay-per-MB escrow**, for light or uncertain usage. The traveler pays the go-to-market rate only for megabytes used. The unused deposit returns to the wallet.
- **A prepaid block of gigabytes** from our eSIM provider's catalog, for heavy, predictable usage. The block is priced at the provider's public retail rate, which is lower per GB.

The repo's note on that catalog says the provider sells a prepaid balance at a per-GB rate, and does not sell named plans (`docs/citrus-mobile-brief.md`). There is no separate fixed-plan price list in the repo. The breakeven below treats a "fixed bundle" as G gigabytes prepaid at the public retail rate. Unused gigabytes on that block are counted as spent, because they are not returned to the wallet automatically. The provider's public FAQ says unused balance can be refunded if the traveler asks support. That is a support request, and it is separate from AstroAm's on-chain refund. Pay-per-MB costs the AstroAm rate times gigabytes actually used. 1 USDC = 1 USD, which is what the code assumes (`USDC_USD_RATE_BPS=10000`).

The prepaid block costs less when gigabytes used are above:

`G × (retail US$/GB) / (AstroAm USDC/GB)`

Retail rates, cheapest network, public pages, 8 October 2026: Chile, Brazil, and Uruguay 1.84; Paraguay 3.89; Bolivia 2.05.

| Destination | Retail (US$/GB) | AstroAm (USDC/GB) | Use more than this share of the block | 5 GB block, breakeven | 10 GB block, breakeven |
|---|---|---|---|---|---|
| Chile, Brazil, Uruguay | 1.84 | 2.48 | 74.2% (1.84 / 2.48) | 3.71 GB | 7.42 GB |
| Paraguay | 3.89 | 5.25 | 74.1% (3.89 / 5.25) | 3.70 GB | 7.41 GB |
| Bolivia | 2.05 | 2.76 | 74.3% (2.05 / 2.76) | 3.71 GB | 7.43 GB |

Worked example, a 5 GB block in Chile, Brazil, or Uruguay: `5 × 1.84 / 2.48 = 3.71` GB. Below 3.71 GB used, pay-per-MB costs less. At 3.71 GB the two cost the same: `3.71 × 2.48` and `5 × 1.84` are both 9.20. Above 3.71 GB the prepaid block costs less. Paraguay: `5 × 3.89 / 5.25 = 3.70` GB. Bolivia: `5 × 2.05 / 2.76 = 3.71` GB. The 10 GB column is the same division with G = 10.

The share is about 1/1.35 (74%) because the traveler's pay-per-MB rate is the retail rate times 1.35. The table uses the rounded prices published above, so the shares land between 74.1% and 74.3%.

Left out of both sides: the $1.75 issue fee, and the card's 30% percepción. This comparison is retail dollars against AstroAm USDC. The per-profile gigabyte estimates (how many GB a week of maps, or of video calls, actually is) are not in the repo, so they are not stated here.

## What is real, and what is not

| Piece | Status |
|---|---|
| Escrow program (deposit, checkpoint, claim, close, timeout refund) | Deployed on devnet. The 2026-10-07 run is linked above: deposit 2.5, two claims totaling 1.875 to the payee, close returning 0.625. |
| Who signed | The traveler signed only the deposit. Checkpoints, claims, and the close were signed by the payee key. |
| Wallet | Phantom or any Wallet Standard wallet. The app does not embed a mock wallet. |
| USDC | Circle's devnet mint, once the traveler holds some. |
| eSIM | Sample test profile from `FakeProvider`. No line is issued. The Citrus adapter stays behind `CONNECTIVITY_PROVIDER=citrus` and is not called. |
| Budget assistant | Rules in the app (daily limit, 20% warning). No model is called. |
| Smart plan selection | Planned onboarding. Not implemented. The comparison is under [Smart plan selection](#smart-plan-selection-planned). |
| Sales channels | Planned. No QR, referral, creator, or wallet deal is live. See [Go-to-market / Sales channels](#go-to-market--sales-channels). |
| Demo video | [`docs/demo/AstroAm-demo-EN.mp4`](docs/demo/AstroAm-demo-EN.mp4) is an older recording. Its picture still says things this README no longer claims. It was not re-recorded: this environment has no Phantom extension and no funded traveler wallet. |

## Roadmap

1. **Issue a real eSIM from the flow and close 10 sessions with travelers on a real trip.** Owner: Joel. The Citrus reseller account, API key and balance exist. What is missing is in [docs/real-esim.md](docs/real-esim.md).
2. Move the upgrade authority and the payee to a 2-of-3 Squads multisig. Owner: Ignacio, who holds the deployer key. What that changes, and what is still trusted today: [Custody and trust model](#custody-and-trust-model).
3. Return the escrow and vault rent to the traveler at `close`.
4. Legal review of the draft terms, including the refund rule and the Argentine right of withdrawal (botón de arrepentimiento), then publish a contact for that request.
5. Bridge liquidation address for collected USDC, only after the provider account exists. See `docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md`.
6. **Direct wholesale supply, as volume grows.** Planned. No extra supplier is signed. The model already in the code scales as it is: `CONNECTIVITY_PROVIDER` is pluggable, any wholesale eSIM API can sit behind it, and the escrow, the meter, and the refund do not depend on which supplier that is. Once the company entity exists and volume justifies it, add direct wholesale eSIM platforms (multi-network wholesalers with APIs) and, later, carrier agreements in the launch corridor (Chile, Brazil, Uruguay, Paraguay, Bolivia), and route each traveler to the cheapest supplier for that country and network. A lower cost per GB leaves room to lower the traveler price or to fund the agency referral fee, and a second supplier keeps a route covered.

## Checks

```bash
npm test
npm run check
npm run solana:test
cd frontend && npm run typecheck
```

`solana:test` runs the program in `solana-program-test`. Rust 1.85 or newer is required. The `.so` is produced by `cargo build-sbf` inside `npm run solana:deploy`.

Terms (draft): the app footer links to `/terms`.
