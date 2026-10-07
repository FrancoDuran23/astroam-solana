# Demo video recording

Playwright script that records `docs/demo/AstroAm-demo-EN.mp4` from the running app.

- `record.mjs` drives the traveler flow (landing → wizard → deposit → eSIM → usage → close) with English captions and title cards.
- The app wallet is Phantom or any Wallet Standard wallet. The script does **not** replace it.
- `dev-only-mock-wallet.js` is a headless stand-in. It runs only when `ASTROAM_DEV_ONLY_MOCK_WALLET=1`. Its signatures are random and are not devnet transactions. Do not use it for a recording you will show judges.
- `esim.mjs` rewrites the eSIM payload to a sample LPA and keeps `isMock` true, so the screen says it is a sample test profile.
- `overlay.js` injects captions, cards and a visible cursor. `fonts.mjs` serves Google Fonts through curl.

The escrow is already on devnet (see the README). This environment could not re-record the video against it: headless Chrome has no Phantom extension, and a fresh wallet received no devnet SOL, so it could not sign a deposit. The existing `docs/demo/AstroAm-demo-EN.mp4` is the older recording. Its captions claimed a Citrus eSIM and an AI copilot. Treat that file as out of date until someone re-records with a real wallet and a real deposit signature on screen.

```bash
npm run server &                          # repo root, with .env from .env.example
(cd frontend && npx vite --port 5173) &
cd docs/demo/recording && npm i playwright@1.56 qrcode && node record.mjs
# optional dry run only: ASTROAM_DEV_ONLY_MOCK_WALLET=1 node record.mjs
# then trim/encode the webm in rec/ with ffmpeg
```
