# AstroAm en Solana

Demo para **Colosseum / Superteam Argentina** (cierra el 12/10/2026). El viajero deposita USDC en Solana **devnet**, el consumo se mide off-chain con un vale acumulativo, y un solo cierre paga a AstroAm lo usado y devuelve el resto. Si AstroAm nunca cierra, un reembolso por timeout devuelve el depósito entero.

La app base vino del build de Stellar ([FrancoDuran23/stellar_jujuy_dev@a19ed4d](https://github.com/FrancoDuran23/stellar_jujuy_dev/tree/a19ed4d)). El canal de Soroban no es el camino de pago de esta demo.

## Video demo

[`docs/demo/AstroAm-demo-EN.mp4`](docs/demo/AstroAm-demo-EN.mp4) (2:28, en inglés). Cómo se grabó: [`docs/demo/recording`](docs/demo/recording/README.md).

## Por qué devnet

Colosseum juzga el producto en Solana devnet: es el cluster al que Phantom puede apuntar y el que tiene faucet. No es localnet (la wallet del juez no habla con un validador local) ni testnet de Solana (otro cluster, sin el USDC que publica Circle). Mainnet no hace falta.

## USDC

Mint de Circle en Solana devnet, el que publican en [USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses):

`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

`getAccountInfo` contra `https://api.devnet.solana.com` devolvió una cuenta de 82 bytes, dueña de `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (SPL Token clásico, no Token-2022). El byte 44 (decimals) es 6 y el byte 45 (inicializado) es 1. La cuenta mint no guarda el símbolo; Circle documenta este mint como USDC. El programa rechaza un mint que no tenga 6 decimales.

El medidor de la app base cuenta en raw de 7 decimales (1 raw = 1e-7 USDC). Ese número no se manda on-chain. 5 USDC son `5_000_000` unidades, no `50_000_000`.

## Qué hace el escrow

Programa nativo en `programs/astroam-escrow` (no debita por MB):

1. **deposit** — el viajero deja USDC en un vault del PDA del escrow. Puede registrar una **clave de sesión** en esa misma transacción.
2. El consumo se mide off-chain y se autoriza con vales acumulativos: la firma ed25519 del viajero, o de su clave de sesión, sobre `(program id, escrow id, monto acumulado)`. Nada de eso es una transacción por MB.
3. **claim** — paga al payee la parte del vale que todavía no cobró y deja el escrow abierto. Reinicia el timeout.
4. **close** — paga el resto del vale y reembolsa lo que queda del depósito en la misma transacción. No puede bajar de lo ya cobrado con `claim`.
5. **refund** — `SOLANA_TIMEOUT_SECONDS` (7 días por defecto) después del depósito, del último `topUp` o del último `claim`, devuelve lo que no se cobró.
6. **topUp** — el mismo viajero puede sumar USDC antes del cierre.

Cualquiera puede enviar `claim`, `close` y `refund`: lo que autoriza el monto es el vale, y el destino es el payee de la config o el viajero.

El escrow **está desplegado en Solana devnet**. El program id que imprimió `solana program deploy` es `8QXPo6yVxZuC3goYzHVLsxVkE1J6BaEqZvfW9e3Do2uq`. El payee, la misma cuenta pública del deployer, es `GmqSpjbis6DZV4easxKdPpRZmhx7RBoDJDsFB2psnYDx`. Esos dos valores están en `.env.example`. Con `cp .env.example .env` el botón de depósito de Phantom o Solflare manda USDC a ese programa. La transacción de deploy es `4APAdDDXSVWkkuqWSmhwJvB7GZDoqbtqZcEivqjsNJCYGFUNQEvsRRYM2ctxzrAVohbxrk4v5pVUSbygvmNZSiMq` y la de initialize es `3QdiV1oBvnbXEFDzdi43LVEED6dgGmnadwjtkti9D2mscwoPVqqx2Zk81aBfCVsLCEbXbeefdFrZwgnJNXSJJNy7`.

## Desplegarlo

1. Instalá el CLI de Solana (Agave):

   ```bash
   sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
   ```

2. Apuntá a devnet y creá una clave si no tenés:

   ```bash
   solana config set --url devnet
   solana-keygen new -o ~/.config/solana/id.json
   ```

3. SOL de devnet para el deployer: [faucet.solana.com](https://faucet.solana.com) (`solana airdrop 2`).
4. La wallet del viajero (Phantom o Solflare, en **Devnet**) necesita SOL para el fee y USDC de Circle en el mint de arriba: [faucet.circle.com](https://faucet.circle.com).
5. Exportá el payee que cobra lo usado (puede ser el deployer):

   ```bash
   export SOLANA_PAYEE_ADDRESS=<pubkey base58>
   # opcional: export SOLANA_DEPLOYER_KEYPAIR=~/.config/solana/id.json
   # opcional: export SOLANA_TIMEOUT_SECONDS=604800
   ```

6. Desde la raíz del repo: `npm run solana:deploy`
7. Copiá las líneas `SOLANA_PROGRAM_ID=` y `SOLANA_PAYEE_ADDRESS=` que imprime el script a `.env` y reiniciá la API. No pegues una dirección que el script no haya impreso.

Sin CLI o sin SOL, `npm run solana:deploy` imprime esos pasos y sale con código 1.

## Correr la app

Node ≥ 22.18.

```bash
cp .env.example .env
npm install
npm run server                         # API en http://localhost:8080

cd frontend && npm install && npm run dev   # app en http://localhost:5173
```

No crees `frontend/.env`: sin `VITE_API_BASE_URL`, Vite reenvía `/api` al backend. Dejá `ASTROAM_LIVE_ENABLED=false` y `CONNECTIVITY_PROVIDER=fake`. `PAYMENT_RAIL=fake` mantiene la medición de demo en memoria; el USDC se mueve solo cuando la wallet manda deposit o close.

La app del viajero es la misma interfaz oscura que AstroAm en Monad (reels, starfield, landing de reembolso). Acá la wallet es Phantom o Solflare, no MetaMask. `.env.example` ya trae el program id de devnet, así que el depósito no es simulado: Phantom deposita USDC de Circle, firma un solo cierre y la landing muestra el USDC que volvió a la wallet. **Refund after timeout** usa ese mismo programa. El tráfico de demo sigue en FakeProvider, sin Citrus. 250 MB en Brasil a 0,0025 USDC/MB sobre 10 USDC son 0,625 usados y 9,375 devueltos.

## Flujo de fondos automático

Decisión: [`docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md`](docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md). El viajero firma **una sola vez**, el depósito. A partir de ahí:

| Paso | Quién | Qué hace |
|---|---|---|
| Vales | la app | Después de cada lectura de consumo firma el vale acumulativo con la clave de sesión y lo manda a `POST /api/missions/:id/vouchers`. Sin popup de wallet. |
| Tramos | el backend | Fondea la eSIM como mucho un tramo (`FUNDING_TRANCHE_CENTS`, $2,50) por delante de lo que cubren los vales, y nunca más de lo que paga el depósito. |
| Cobro | el backend | Cuando el vale junta `CLAIM_MIN_USDC` sin cobrar, manda un `claim`. |
| Cierre | el backend | Manda el `close` cuando el viajero termina el viaje (`POST /api/missions/:id/settle`), se gasta el depósito, pasa la fecha de fin o falta un día para el timeout del escrow. |
| Tesorería | el backend | Barre el USDC cobrado a `BRIDGE_LIQUIDATION_ADDRESS`, dejando `TREASURY_FLOAT_USDC` en el payee. Ver [Treasury](#treasury). |

Lo que AstroAm puede perder es un tramo: sin un vale nuevo no se fondea más, y un cierre con un vale viejo no recupera lo ya cobrado.

Se prende en dos pasos, y cada uno funciona sin el siguiente:

1. `npm run solana:upgrade` reemplaza el código del programa ya desplegado, en la misma dirección. Hace falta la clave que lo desplegó (su *upgrade authority*, `GmqSpjbis6DZV4easxKdPpRZmhx7RBoDJDsFB2psnYDx`). Después, `SOLANA_ESCROW_SESSION_KEYS=true` en `.env`. Con esto solo, la app firma los vales y la wallet aprueba el depósito y la transacción de cierre, sin el popup de firmar mensaje.
2. `SOLANA_OPERATOR_KEYPAIR=<archivo de la clave>` en `.env`. El backend lee cada depósito del escrow en vez de creerle al pedido, corre el trabajo de fondos cada `FUND_FLOW_INTERVAL_MS` y manda él los `claim` y el `close`. Para barrer a Bridge, esa clave tiene que ser la del payee.

Sin ninguna de las dos variables la app se comporta como antes.

El barrido y la pausa por auto-recarga fallida están en el código. Sigue siendo manual abrir la cuenta de Bridge, guardar la tarjeta en Citrus y confirmar con soporte si la auto-recarga corre sin un grupo compartido: el checklist está en [Treasury](#treasury). El programa actualizado todavía no se desplegó en devnet. Si `solana program deploy` dice que la cuenta del programa quedó chica, `solana program extend <program id> <bytes>` la agranda.

## Treasury

Circle USDC leaves the Solana escrow when the backend `claim`s or `close`s: the payee token account receives what the traveler used. The treasury sweep then sends that USDC to a [Bridge](https://bridge.xyz) liquidation address. Bridge converts it and deposits USD in AstroAm's bank. That bank backs the card Citrus auto-refills from. Citrus does not accept crypto. eSIM funding stays `POST /esim/{iccid}/fund` against the reseller USD balance. There is no Citrus top-up API.

```
USDC escrow → payee wallet → Bridge liquidation address → AstroAm bank → Citrus auto-refill card → reseller balance → eSIM wallet
```

The sweep runs at the end of each fund-flow tick, after that tick's claims and closes. It is off when `BRIDGE_LIQUIDATION_ADDRESS` is empty, and collected USDC stays in the payee wallet. When the address is set, the job transfers USDC only if the payee holds more than `TREASURY_FLOAT_USDC` by at least `TREASURY_SWEEP_MIN_USDC` (default **1 USDC**, the published minimum on the Solana USDC → USD route). The float stays in the payee wallet. Each sweep is logged with its transaction signature. The next tick does not send again until new USDC arrives above the float and the minimum. No Bridge HTTP API is required: an SPL USDC transfer to the address is the integration.

Bridge's orchestration fee is about **0.25%** (orientative), plus the rail. ACH is nearly zero. Exact wire and FedNow costs are not fixed here, and the sweep does not deduct a fee of its own.

`balance.auto_refill_failed` pauses new eSIM provisioning and new tranche funding until `balance.auto_refill_succeeded` or `balance.topped_up`. Claims, closes, and the sweep keep running. `balance.low` and `balance.depleted` are logged as alerts and do not pause funding, because auto-refill may still succeed. The same pause applies with `CONNECTIVITY_PROVIDER=fake`.

### One-time setup

1. Open a Bridge account and create a Solana / USDC liquidation address that pays AstroAm's bank. Put that address in `BRIDGE_LIQUIDATION_ADDRESS`. `SOLANA_OPERATOR_KEYPAIR` has to be the payee key, because only the payee can move the collected USDC.
2. In the Citrus developer dashboard, save the card that bank account backs and turn on auto-refill. Refills are dashboard or auto-refill only.
3. Email support@citrusmobile.com and ask whether account auto-refill fires when the reseller balance drops **without** a shared balance group. Traveler eSIMs stay standalone: a SIM inside a group has no individual wallet. That answer is still unknown.

Until those are done, leave `BRIDGE_LIQUIDATION_ADDRESS` empty and refill Citrus by hand from the dashboard.

## Cheques

```bash
npm test                               # cotización en 6 decimales, no el raw de 7
npm run solana:test                    # deposit, clave de sesión, claim, close con reembolso, timeout
npm run check
cd frontend && npx tsc --noEmit
```

`solana:test` corre el programa en `solana-program-test` (el binario BPF no hace falta para los tests). Hace falta Rust 1.85 o más nuevo: una dependencia transitiva usa edition 2024. El `.so` lo produce `cargo build-sbf` dentro de `npm run solana:deploy`.
