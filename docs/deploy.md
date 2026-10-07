# Publish the demo

Two processes: the API (this repo root) and the traveler app (`frontend/`). No secret belongs in git. Copy `.env.example` to `.env`. It already has the team's devnet program, payee, and meter public key. Do not replace those three.

The meter and operator private keys are not in the repo. Whoever holds them can set `SOLANA_METER_KEYPAIR_JSON` and `SOLANA_OPERATOR_KEYPAIR_JSON` on the host so the API can sign a close. Without those secrets the API still serves the app and a Phantom deposit still lands in the escrow. A close waits for the meter key, or for the 7-day timeout refund.

The eSIM provider stays on `CONNECTIVITY_PROVIDER=fake`. Do not set `citrus` and do not put a Citrus API key on a public demo.

## API on Render

1. New Web Service from this repo. Render can read `render.yaml`.
2. Node 22. Start command is `npm run server`. Health check is `GET /health`.
3. In the dashboard, set:
   - Leave `SOLANA_PROGRAM_ID`, `SOLANA_PAYEE_ADDRESS`, and `SOLANA_METER_PUBKEY` as they are in `.env.example`
   - `SOLANA_METER_KEYPAIR_JSON` and `SOLANA_OPERATOR_KEYPAIR_JSON`: the 64-number JSON arrays from `solana-keygen`, as secret env vars
   - `FRONTEND_ORIGIN`: the public app origin, for example `https://astroam.netlify.app`
4. Leave `CITRUS_API_KEY` empty.

`SOLANA_*_KEYPAIR_JSON` is the same file `solana-keygen` writes, pasted as one line. The process never logs it.

## API on Fly

```bash
# From the repo root, after `fly auth login`. Pick your own app name.
fly launch --no-deploy --copy-config
fly secrets set \
  SOLANA_PROGRAM_ID=... \
  SOLANA_PAYEE_ADDRESS=... \
  SOLANA_METER_PUBKEY=... \
  SOLANA_METER_KEYPAIR_JSON='[...]' \
  SOLANA_OPERATOR_KEYPAIR_JSON='[...]' \
  FRONTEND_ORIGIN=https://your-app.example
fly deploy
```

`fly.toml` already points at `Dockerfile`. The image listens on `0.0.0.0:8080`. Change the `app` name before the first deploy if `astroam-api` is taken.

## Traveler app on Netlify or Vercel

Set the project root to `frontend/`.

- Netlify reads `frontend/netlify.toml`.
- Vercel reads `frontend/vercel.json`.

Build command: `npm run build`. Publish `dist`. Set this at **build** time:

```
VITE_ASTROAM_MODE=api
VITE_API_BASE_URL=https://<your-api-host>/api
```

The app has no private keys. It asks Phantom (or any Wallet Standard wallet) to sign. The wallet must be on Solana Devnet.

## After it is up

1. Open `/health` on the API. It should say `alive`.
2. Open the app. The badge should say `SOLANA DEVNET` once the program id is set, or `PROGRAM NOT SET` if it is not.
3. Terms are at `/terms` (a draft).
4. A judge needs devnet SOL from [faucet.solana.com](https://faucet.solana.com) and Circle devnet USDC from [faucet.circle.com](https://faucet.circle.com) (mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).
