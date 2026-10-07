# AstroAm en Solana

Demo para **Colosseum / Superteam Argentina** (cierra el 12/10/2026). El viajero deposita USDC en Solana **devnet**, el consumo se mide off-chain con un vale acumulativo firmado por la clave del medidor de AstroAm, y un solo cierre paga a AstroAm lo usado y devuelve el resto. Si nadie cierra, el timeout paga al payee el último monto atestiguado y devuelve solo el resto al viajero.

La app base vino del build de Stellar ([FrancoDuran23/stellar_jujuy_dev@a19ed4d](https://github.com/FrancoDuran23/stellar_jujuy_dev/tree/a19ed4d)). El canal de Soroban no es el camino de pago de esta demo.

## Team & roles

Team of four, based in Jujuy, Argentina, working full-time remote.

| Name | GitHub | Role | Main areas |
|---|---|---|---|
| Franco Agustín Durán (founder) | [@FrancoDuran23](https://github.com/FrancoDuran23) | Escrow program, payments backend, and frontend | Solana escrow (`programs/astroam-escrow`, deploy and fund flow); payments channel and vouchers on Stellar; contract and UI on Monad |
| Ignacio Martín | [@ignaMartin22](https://github.com/ignaMartin22) | Connectivity (eSIM) and escrow contracts | Citrus/Telnyx, usage and webhooks on Stellar; escrow `claim` and refunds on Monad. The Solana meter-key close and the timeout that pays the attested amount are in this program |
| Daniel Palermo | [@DanielPalermoo](https://github.com/DanielPalermoo) | Backend and metering | Traffic meter, Soroban adapter, and CosmoPay gateway (Stellar build) |
| Joel | [@Joel010999](https://github.com/Joel010999) | Frontend | Traveler app, mobile, eSIM flow in the UI, and product API (Stellar build) |

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

1. **deposit** — el viajero deja USDC en un vault del PDA del escrow. Puede registrar una clave de sesión en esa misma transacción. Esa clave no firma vales.
2. El consumo se mide off-chain. Un vale acumulativo lo firma la **clave del medidor** guardada en la config del programa, con ed25519 sobre `(program id, escrow id, monto acumulado)`. Ni el viajero ni la clave de sesión pueden firmarlo. Nada de eso es una transacción por MB.
3. **checkpoint** — graba en el escrow el último vale del medidor, sin mover USDC y sin reiniciar el timeout.
4. **claim** — paga al payee la parte del vale que todavía no cobró y deja el escrow abierto. Reinicia el timeout.
5. **close** — exige un vale del medidor, con monto entre lo ya atestiguado y el depósito. Paga el resto y reembolsa lo que queda, en la misma transacción.
6. **refund** — `SOLANA_TIMEOUT_SECONDS` (7 días por defecto) después del depósito, del último `topUp` o del último `claim`, paga al payee lo atestiguado que no se cobró y devuelve al viajero solo el resto. Un checkpoint no corre ese plazo.
7. **topUp** — el mismo viajero puede sumar USDC antes del cierre.

Cualquiera puede enviar `checkpoint`, `claim`, `close` y `refund`. El monto lo autoriza la firma del medidor, y el destino es el payee de la config o el viajero. El cobro nunca pasa el depósito.

## Trust model

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

The config grew to 106 bytes to store the meter key, so the first program, at `8QXPo6yVxZuC3goYzHVLsxVkE1J6BaEqZvfW9e3Do2uq`, could not take this code with `--upgrade`. This code was deployed as a new program with `npm run solana:deploy` (below). The first program stays on devnet and its escrows still close and refund, but `.env.example` no longer points at it.

El escrow **está desplegado en Solana devnet**. El program id que imprimió `npm run solana:deploy` es `HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk`. Su config (`4igZjvwU4sfiu4dsRAzcyk2PqQGBgZqhJ8ddnczXpy3o`, 106 bytes) guarda:

| Campo | Valor |
|---|---|
| Payee y upgrade authority (el deployer) | `9NMAvdKGJibTUFW4mWRfVd4sZRpLNo3fQCQMqdrXXV89` |
| Clave del medidor | `3WqaNhVVCCnabBLGA9YWviQHDvo6fTmX1Y9otcmsdB7k` |
| Mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (USDC de Circle) |
| Timeout | 604800 s (7 días) |

Esos valores están en `.env.example`. La transacción de initialize es `5sCmaunoJLppYh6wgzcbY3hmCD9w52HuK9D8HYLWzPpKdrqxotM3fzW4gRXds5jZWNWov4xYpxzttkoZbk8h5Gxp` y la del último deploy del código es `3jqc3Z5mLvPeyg3bj81TnTbbNamBAEfbYu6c8QxVj9nV7TQsymy3CTWF4W2BdPwjaxBJSRpotyrxayjizgmGXpqs`.

Con `cp .env.example .env` el botón de depósito de Phantom o Solflare manda USDC a ese programa. El vale que permite cerrar lo firma solo la clave del medidor, así que el cierre automático, los `checkpoint` y los `claim` corren únicamente en una API que tenga `SOLANA_METER_KEYPAIR` (y `SOLANA_OPERATOR_KEYPAIR` para mandarlos). Sin esa clave el depósito funciona y lo vuelve a liberar el `refund` del timeout.

El primer programa (`8QXPo6yVxZuC3goYzHVLsxVkE1J6BaEqZvfW9e3Do2uq`, payee `GmqSpjbis6DZV4easxKdPpRZmhx7RBoDJDsFB2psnYDx`, sin clave de medidor) sigue en devnet. Su deploy fue `4APAdDDXSVWkkuqWSmhwJvB7GZDoqbtqZcEivqjsNJCYGFUNQEvsRRYM2ctxzrAVohbxrk4v5pVUSbygvmNZSiMq` y su initialize `3QdiV1oBvnbXEFDzdi43LVEED6dgGmnadwjtkti9D2mscwoPVqqx2Zk81aBfCVsLCEbXbeefdFrZwgnJNXSJJNy7`.

Las claves privadas (`id.json` del deployer, `meter.json` del medidor y el keypair del programa en `programs/astroam-escrow/target/deploy/`) no están en el repo y no van a estar. Quien las tenga hace un backup fuera de la máquina. Sin `id.json` no se puede actualizar el programa ni mover el USDC cobrado; sin `meter.json` la API no puede firmar vales para este programa.

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
   solana-keygen new -o ~/.config/solana/meter.json
   export SOLANA_METER_KEYPAIR=~/.config/solana/meter.json
   # opcional: export SOLANA_DEPLOYER_KEYPAIR=~/.config/solana/id.json
   # opcional: export SOLANA_TIMEOUT_SECONDS=604800
   ```

6. Desde la raíz del repo: `npm run solana:deploy`
7. Copiá las líneas `SOLANA_PROGRAM_ID=`, `SOLANA_PAYEE_ADDRESS=` y `SOLANA_METER_PUBKEY=` que imprime el script a `.env`, y dejá `SOLANA_METER_KEYPAIR` apuntando al archivo de la clave. Reiniciá la API. No pegues una dirección que el script no haya impreso. `npm run solana:upgrade` solo sirve para un programa cuya config ya tiene 106 bytes y el mismo medidor.

Sin CLI o sin SOL, `npm run solana:deploy` imprime esos pasos y sale con código 1.

## Probar con tu propio deploy

Para probar el cierre con vale del medidor en devnet, la API necesita la clave privada del medidor de ese programa. La del programa de arriba no está en el repo, así que cada integrante del equipo despliega su propia copia, con su deployer y su medidor. En devnet es gratis y no comparte ningún secreto.

Sin deploy ya se puede probar bastante: `npm test`, `npm run solana:test` (el programa entero en `solana-program-test`, sin claves) y la app con `VITE_ASTROAM_MODE=demo`.

### En Windows: compilar y desplegar desde WSL

`cargo build-sbf` no anda bien en Windows nativo. La compilación y el deploy se hacen en Ubuntu (WSL), y la API y el frontend siguen corriendo en Windows. Todos los comandos de esta parte van **en la terminal de Ubuntu** (`wsl`), no en PowerShell: si PowerShell dice que no reconoce `solana-keygen`, es porque estás en la terminal equivocada.

1. Herramientas (una vez):

   ```bash
   sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev libudev-dev curl rsync
   curl https://sh.rustup.rs -sSf | sh -s -- -y && source ~/.cargo/env
   sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
   echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc && nvm install 22
   ```

   El Node de Windows no sirve dentro de WSL: hace falta este.

2. Claves, guardadas en la carpeta de Windows para que la API las lea después. A `BIP39 Passphrase` respondé con Enter (vacía):

   ```bash
   mkdir -p /mnt/c/Users/<usuario>/.config/solana
   solana-keygen new -o /mnt/c/Users/<usuario>/.config/solana/id.json     # deployer = payee = operador
   solana-keygen new -o /mnt/c/Users/<usuario>/.config/solana/meter.json  # medidor, otra clave
   solana config set --url devnet --keypair /mnt/c/Users/<usuario>/.config/solana/id.json
   solana airdrop 2    # o https://faucet.solana.com
   ```

3. Una copia del repo en el disco de Linux. Compilar sobre `/mnt/c` falla con `Cannot allocate memory (os error 12)`:

   ```bash
   rsync -a --exclude node_modules --exclude target --exclude .git \
     /mnt/c/<ruta al repo>/ ~/astroam/
   cd ~/astroam && npm install
   ```

4. Deploy:

   ```bash
   export CARGO_BUILD_JOBS=2    # 1 si vuelve a faltar memoria
   export SOLANA_DEPLOYER_KEYPAIR=/mnt/c/Users/<usuario>/.config/solana/id.json
   export SOLANA_METER_KEYPAIR=/mnt/c/Users/<usuario>/.config/solana/meter.json
   npm run solana:deploy
   ```

   Si corta con `fetch failed` después de compilar, el programa ya se subió y falta el initialize. Corré `export NODE_OPTIONS=--dns-result-order=ipv4first` y volvé a ejecutar `npm run solana:deploy`: usa el mismo keypair de `target/deploy/` y despliega al mismo program id. No borres esa carpeta.

En Linux o macOS se saltean la copia y las rutas `/mnt/c`: alcanza con los pasos de [Desplegarlo](#desplegarlo).

### Tu `.env`

`cp .env.example .env` y reemplazá con lo que imprimió **tu** deploy:

```bash
SOLANA_PROGRAM_ID=<el tuyo>
SOLANA_PAYEE_ADDRESS=<el tuyo>
SOLANA_METER_PUBKEY=<el tuyo>
SOLANA_ESCROW_SESSION_KEYS=true
SOLANA_METER_KEYPAIR=C:/Users/<usuario>/.config/solana/meter.json
SOLANA_OPERATOR_KEYPAIR=C:/Users/<usuario>/.config/solana/id.json
```

Las rutas de las claves van absolutas y en el formato del sistema donde corre la API (en Windows, `C:/...`, no las `/mnt/c/...` que imprime el script). La API no expande `~`. Para ver un `claim` con el tráfico de demo (250 MB son 0,625 USDC), bajá `CLAIM_MIN_USDC` a `0.5`; `FUND_FLOW_INTERVAL_MS=15000` acorta la espera.

Al arrancar `npm run server`, el log tiene que decir `fund flow is automatic` y no `operator key not loaded` ni `meter key not loaded`. `http://localhost:8080/api/capabilities` muestra tu program id y `escrowAutomation: true`.

### La wallet del viajero

Phantom o Solflare en **Devnet**, con una cuenta distinta de tu deployer: SOL de [faucet.solana.com](https://faucet.solana.com) y USDC de [faucet.circle.com](https://faucet.circle.com) (Solana Devnet). Si tenés las dos extensiones, la app usa Phantom primero: desactivala para probar con Solflare. El viajero firma solo el depósito; ni **Use 250 MB** ni el cierre abren la wallet.

### Claves

`id.json`, `meter.json` y `target/deploy/astroam_escrow-keypair.json` no se commitean ni se pegan en un chat. Hacé un backup fuera de la máquina. Una clave de operador no tiene que ser la del payee: cualquier cuenta con SOL de devnet puede mandar `checkpoint`, `claim` y `close`. Solo el barrido a Bridge necesita la del payee.

## Correr la app

Node ≥ 22.18.

```bash
cp .env.example .env
npm install
npm run server                         # API en http://localhost:8080

cd frontend && npm install && npm run dev   # app en http://localhost:5173
```

No crees `frontend/.env`: sin `VITE_API_BASE_URL`, Vite reenvía `/api` al backend. Dejá `ASTROAM_LIVE_ENABLED=false` y `CONNECTIVITY_PROVIDER=fake`. `PAYMENT_RAIL=fake` mantiene la medición de demo en memoria; el USDC se mueve solo cuando la wallet manda deposit, close o refund.

La app del viajero es la misma interfaz oscura que AstroAm en Monad (reels, starfield, landing de reembolso). Acá la wallet es Phantom o Solflare, no MetaMask. `.env.example` ya trae el program id de devnet con clave de medidor. Para el cierre con vale del medidor, `SOLANA_METER_KEYPAIR` y `SOLANA_OPERATOR_KEYPAIR` apuntan a los archivos de clave (rutas absolutas). La landing muestra el USDC que volvió a la wallet. **Refund after timeout** paga lo atestiguado y devuelve el resto. El tráfico de demo sigue en FakeProvider, sin Citrus. 250 MB en Brasil a 0,0025 USDC/MB sobre 10 USDC son 0,625 usados y 9,375 devueltos.

## Flujo de fondos automático

Decisión: [`docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md`](docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md). El viajero firma **una sola vez**, el depósito. A partir de ahí:

| Paso | Quién | Qué hace |
|---|---|---|
| Vales | el backend | Después de cada lectura de consumo la clave del medidor firma el vale acumulativo. `POST /api/missions/:id/attest` lo graba en el escrow (`checkpoint`). Sin popup de wallet. |
| Tramos | el backend | Fondea la eSIM como mucho un tramo (`FUNDING_TRANCHE_CENTS`, $2,50) por delante de lo que cubren los vales, y nunca más de lo que paga el depósito. |
| Cobro | el backend | Cuando el vale junta `CLAIM_MIN_USDC` sin cobrar, manda un `claim`. |
| Cierre | el backend | Manda el `close` cuando el viajero termina el viaje (`POST /api/missions/:id/settle`), se gasta el depósito, pasa la fecha de fin o falta un día para el timeout del escrow. |
| Tesorería | el backend | Barre el USDC cobrado a `BRIDGE_LIQUIDATION_ADDRESS`. |

Lo que AstroAm puede perder es un tramo: sin un vale nuevo no se fondea más, y un cierre no puede bajar de lo ya cobrado ni de lo ya atestiguado.

Se prende con un deploy nuevo, porque la config ahora guarda la clave del medidor (106 bytes) y el programa ya desplegado no se puede agrandar con `--upgrade`:

1. `SOLANA_METER_KEYPAIR=<archivo>` y `npm run solana:deploy`. Copiá el `SOLANA_PROGRAM_ID` y el `SOLANA_METER_PUBKEY` que imprime. Con el meter key la API firma los vales. La wallet aprueba el depósito y, si no hay operator key, la transacción de cierre, sin firmar el monto.
2. `SOLANA_OPERATOR_KEYPAIR=<archivo de la clave>` en `.env`. El backend lee cada depósito del escrow en vez de creerle al pedido, corre el trabajo de fondos cada `FUND_FLOW_INTERVAL_MS` y manda él el `checkpoint`, los `claim` y el `close`. Para barrer a Bridge, esa clave tiene que ser la del payee.

Sin esas variables la API no puede firmar un vale, y el programa viejo sigue rechazando un cierre que no firme el viajero.

Falta, y no está en el código: abrir la cuenta de Bridge y crear la liquidation address, configurar en Citrus la tarjeta y la auto-recarga, y probar el lazo con una eSIM real. El programa con clave de medidor ya está en devnet (arriba). Si `solana program deploy` dice que la cuenta del programa quedó chica, `solana program extend <program id> <bytes>` la agranda.

## Cheques

```bash
npm test                               # cotización en 6 decimales, no el raw de 7
npm run solana:test                    # deposit, checkpoint, claim, close, timeout paga lo atestiguado
npm run check
cd frontend && npx tsc --noEmit
```

`solana:test` corre el programa en `solana-program-test` (el binario BPF no hace falta para los tests). Hace falta Rust 1.85 o más nuevo: una dependencia transitiva usa edition 2024. El `.so` lo produce `cargo build-sbf` dentro de `npm run solana:deploy`.
