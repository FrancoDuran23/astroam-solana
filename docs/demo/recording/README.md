# Demo video recording

Playwright script that records a demo video of the traveler flow from the running app.

- `record.mjs` drives the traveler flow (landing → wizard → deposit → eSIM → usage → close) with English captions and title cards.
- The app wallet is Phantom or any Wallet Standard wallet. The script does **not** replace it.
- `dev-only-mock-wallet.js` is a headless stand-in. It runs only when `ASTROAM_DEV_ONLY_MOCK_WALLET=1`. Its signatures are random and are not devnet transactions. Do not use it for a recording you will show judges.
- `esim.mjs` rewrites the eSIM payload to a stand-in LPA and keeps `isMock` true, for this recording script only. The script does not call Citrus. The product eSIM has been tested with Citrus and works when `CONNECTIVITY_PROVIDER=citrus`.
- `overlay.js` injects captions, cards and a visible cursor. `fonts.mjs` serves Google Fonts through curl.

The escrow is already on devnet (see the README). This environment could not re-record the video against it: headless Chrome has no Phantom extension, and a fresh wallet received no devnet SOL, so it could not sign a deposit. The older recording made with this script was removed from the repo. A new one needs a real wallet and a real deposit signature on screen.

```bash
npm run server &                          # repo root, with .env from .env.example
(cd frontend && npx vite --port 5173) &
cd docs/demo/recording && npm i playwright@1.56 qrcode && node record.mjs
# optional dry run only: ASTROAM_DEV_ONLY_MOCK_WALLET=1 node record.mjs
# then trim/encode the webm in rec/ with ffmpeg
```
