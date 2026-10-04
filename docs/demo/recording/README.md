# Demo video recording

Playwright script that records `docs/demo/AstroAm-demo-EN.mp4` from the running app.

- `record.mjs` drives the traveler flow (landing → wizard → deposit → eSIM → usage → close) with English captions and title cards.
- `mock-solana.js` replaces `frontend/src/chain/solana.ts` during the recording only: headless Chromium has no Phantom and no devnet access, so wallet signatures and wallet balances are mocked. The app, API and FakeRail are real.
- `esim.mjs` rewrites API responses so the eSIM screen shows a scannable QR and a sample LPA/ICCID instead of the FakeProvider placeholder.
- `overlay.js` injects captions, cards and a visible cursor. `fonts.mjs` serves Google Fonts through curl.

```bash
npm run server &                          # repo root, with .env from .env.example
(cd frontend && npx vite --port 5173) &
cd docs/demo/recording && npm i playwright@1.56 qrcode && node record.mjs
# then trim/encode the webm in rec/ with ffmpeg
```
