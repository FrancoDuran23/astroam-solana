# AstroAm

Prepaid travel data: you lock USDC on Solana, pay only for what a meter attests, and the rest comes back to your wallet.

Demo for Colosseum / Superteam Argentina. Deadline: Sunday 11 October 2026, 23:59 ART. The traveler app started from the Stellar build ([FrancoDuran23/stellar_jujuy_dev@a19ed4d](https://github.com/FrancoDuran23/stellar_jujuy_dev/tree/a19ed4d)). The Soroban channel is not the payment path of this demo.

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

### Trust model

AstroAm's meter key is the only key that can sign a usage voucher. The program stores that public key in its config at initialize. `checkpoint`, `claim` and `close` check the signature with the ed25519 precompile, through the instructions sysvar. A voucher signed by the traveler, by the session key registered at deposit, or by the payee is rejected. The traveler therefore cannot block settlement, and cannot understate what was used, by withholding a signature.

The amount charged can never exceed the deposit. `checkpoint`, `claim` and `close` reject a cumulative amount above it, and `close` also rejects an amount below what was already claimed or below the last checkpoint. The traveler's refund is `deposit − attested`.

Each traveler has their own escrow PDA, derived from that trip's escrow id, and a token vault PDA that holds the USDC. Both accounts are owned by the program. Nobody on the team can move that USDC with a wallet: the program only transfers it to the configured payee (the attested amount) or back to the traveler (the remainder).

Usage is metered off-chain, so a meter that over-reports could charge more than the traveler used, up to the deposit. That is bounded by the cap above, and it is auditable: every checkpoint and close is a transaction whose voucher message is `AstroAmEscrow:v1:close || program id || escrow id || amount`, signed by the published meter key. The carrier's usage record for the same ICCID is the other side of that check. A disagreement is visible on the explorer and in the provider's usage log; it does not require trusting a traveler signature.

The program upgrade authority is still the deployer key (`9NMAvdKGJibTUFW4mWRfVd4sZRpLNo3fQCQMqdrXXV89` on the current devnet deployment). The payee that receives used USDC is that same key. Both are planned to move to a 2-of-3 Squads multisig so no single laptop can upgrade the program or spend the treasury. The USDC sitting in a traveler's vault is not part of that treasury: the multisig cannot transfer it either.

After the Squads vault exists:

```bash
# Program upgrades then require 2 of 3 signers.
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <SQUADS_VAULT> \
  --keypair <CURRENT_UPGRADE_AUTHORITY>

# The payee is fixed in the program config and there is no set_payee
# instruction. Point a new deployment at the vault:
#   export SOLANA_PAYEE_ADDRESS=<SQUADS_VAULT>
#   npm run solana:deploy
# or sweep USDC already collected by the current payee to that vault.
```

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

## What is real, and what is not

| Piece | Status |
|---|---|
| Escrow program (deposit, checkpoint, claim, close, timeout refund) | Deployed on devnet. The 2026-10-07 run is linked above: deposit 2.5, two claims totaling 1.875 to the payee, close returning 0.625. |
| Who signed | The traveler signed only the deposit. Checkpoints, claims, and the close were signed by the payee key. |
| Wallet | Phantom or any Wallet Standard wallet. The app does not embed a mock wallet. |
| USDC | Circle's devnet mint, once the traveler holds some. |
| eSIM | Sample test profile from `FakeProvider`. No line is issued. The Citrus adapter stays behind `CONNECTIVITY_PROVIDER=citrus` and is not called. |
| Budget assistant | Rules in the app (daily limit, 20% warning). No model is called. |
| Demo video | [`docs/demo/AstroAm-demo-EN.mp4`](docs/demo/AstroAm-demo-EN.mp4) is an older recording. Its picture still says things this README no longer claims. It was not re-recorded: this environment has no Phantom extension and no funded traveler wallet. |

## Roadmap

1. Move the upgrade authority and the payee to a 2-of-3 Squads multisig.
2. Connect a real eSIM provider (the Citrus adapter is the candidate) and replace the sample profile.
3. Legal review of the draft terms, including the refund rule and the Argentine right of withdrawal (botón de arrepentimiento), then publish a contact for that request.
4. Bridge liquidation address for collected USDC, only after the provider account exists. See `docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md`.

## Checks

```bash
npm test
npm run check
npm run solana:test
cd frontend && npm run typecheck
```

`solana:test` runs the program in `solana-program-test`. Rust 1.85 or newer is required. The `.so` is produced by `cargo build-sbf` inside `npm run solana:deploy`.

Terms (draft): the app footer links to `/terms`.
