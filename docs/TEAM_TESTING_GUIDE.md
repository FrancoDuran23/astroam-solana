# AstroAm — Guía Completa de Onboarding y Testing del Equipo

Esta guía detalla todo lo necesario para que cualquier desarrollador o tester del equipo pueda clonar, configurar, ejecutar, probar y comprender la arquitectura técnica y el estado actual de **AstroAm** en la rama `feature/cctp-arq-treasury`.

---

## A. Estado Actual del Proyecto

AstroAm es una plataforma de conectividad global (eSIM) alimentada por pagos con micro-vouchers en Solana Escrow y respaldada por un esquema de liquidez cruzada (Solana → Circle CCTP v2 → Polygon EOA → ARQ Card → Citrus Reseller API).

### Flujo Global de Valor y Datos

```
Traveler
  │
  ▼
Solana Escrow Program
  │
  ├─► Meter Vouchers (MB consumidos)
  │     └─► Checkpoint / Claim / Close / Refund
  │
  ▼
AstroAm Treasury (Solana Payee Account)
  │
  ▼
LiquidityPolicy & TreasuryRebalancer
  │
  ▼
Circle CCTP v2 (Burn USDC on Solana)
  │
  ▼
Wormhole Executor (Relay cross-chain)
  │
  ▼
Polygon Treasury EOA (Mint & Receive USDC)
  │
  ▼
ARQ Deposit Address (Native USDC on Polygon)
  │
  ▼
ARQ Global Card (Accreditation)
  │
  ▼
Citrus Reseller Account (eSIM Funding)
```

### Tabla de Estado de Componentes

| COMPONENTE | ESTADO | NOTAS |
| :--- | :--- | :--- |
| **Escrow Program** | `REAL / devnet tested` | Programa Anchor desplegado en Solana Devnet |
| **Meter** | `REAL / devnet tested` | Firma off-chain de vouchers de consumo en MB |
| **Claims** | `REAL` | Reclamo de fondos acumulados al Payee |
| **Refund** | `REAL` | Devolución de remanente al traveler tras cierre |
| **TreasuryRouter** | `implemented` | Orquestación CCTP v2 + Wormhole Executor + Polygon ARQ |
| **LiquidityPolicy** | `implemented` | Cálculo atómico de buffers y rebalanceo sin saldos flotantes |
| **FundingGate** | `implemented` | Bloqueo/desbloqueo de provisiones según balance de Citrus |
| **CCTP v2** | `coded-not-live-mainnet-tested` | Integración Circle CCTP codificada y testada con mocks |
| **Wormhole Executor** | `coded-not-live-mainnet-tested` | Cliente HTTP oficial (`/v0/quote`, `/v0/status/tx`) codificado |
| **Polygon treasury EOA** | `coded-not-live-mainnet-tested` | Transferencia nativa de USDC ERC20 con gas dinámico POL |
| **Polygon → ARQ** | `coded-not-live-mainnet-tested` | Adaptador EOA → ARQ deposit address testado con mocks |
| **ARQ accreditation** | `manual/external` | Acreditación en plataforma ARQ |
| **ARQ card** | `external` | Tarjeta virtual corporativa |
| **Citrus API** | `real adapter` | Adaptador para API oficial de Citrus Reseller |
| **Citrus fake provider** | `available for team testing` | Simulación in-memory para testing local del equipo |
| **Yield / Kamino** | `deferred/noop` | Estrategia de rendimiento diferida fuera del alcance actual |

> [!IMPORTANT]
> **No se han ejecutado transacciones con fondos reales en Mainnet.** Todas las integraciones de CCTP, Wormhole Executor, Polygon EOA y ARQ están totalmente probadas mediante mocks unitarios e integrados.

---

## B. Requisitos de Desarrollo

Para ejecutar y validar el proyecto en tu máquina local se requieren los siguientes entornos y herramientas:

* **Git**: `v2.30+` (para gestión de control de versiones).
* **Node.js**: `v18.x` o `v20.x` LTS (requerido para backend y frontend).
* **npm**: `v9.x` o `v10.x` (incluido con Node.js).
* **Rust & Solana CLI** *(Opcional)*: Requerido únicamente si deseas recompilar o desplegar el programa Anchor `programs/astroam-escrow/`. No es necesario para probar el backend/frontend con la testnet/devnet configurada.
* **Entorno OS**:
  * **Linux / macOS**: Soporte nativo para todo el stack.
  * **Windows (PowerShell / CMD)**: Soporte completo para Backend, Frontend y Tests (`npm test`). Si deseas recompilar el contrato Anchor en Windows, se recomienda utilizar **WSL2 (Ubuntu)**.

---

## C. Clonar el Repositorio desde Cero

Si vas a realizar una instalación limpia desde GitHub:

```bash
git clone https://github.com/FrancoDuran23/astroam-solana.git
cd astroam-solana
git fetch origin
git switch feature/cctp-arq-treasury
git pull origin feature/cctp-arq-treasury
```

### Verificar Rama y Estado
```bash
git branch --show-current
# Debe devolver: feature/cctp-arq-treasury

git status
# Debe indicar que estás en la rama correcta y sincronizado
```

---

## D. Si ya tienes el Repo Clonado

Si ya tenías el proyecto en tu máquina local:

```bash
git fetch --all --prune
git switch feature/cctp-arq-treasury
git pull --ff-only
```

> [!WARNING]
> Si tienes cambios locales sin guardar, haz un `git stash` o crea un commit temporal en una rama propia antes de cambiar a `feature/cctp-arq-treasury`. No borres ni sobrescribas cambios de trabajo sin verificar.

---

## E. Instalación de Dependencias

Ejecuta la instalación en la raíz del proyecto y luego en la subcarpeta del frontend:

```bash
# 1. Dependencias del Backend y scripts raíz
npm install

# 2. Dependencias del Frontend (Vite + React)
cd frontend
npm install
cd ..
```

* `npm install` (raíz): Instala Express, Solana Web3.js, Anchor, ethers.js, TypeScript, Vitest y utilidades de backend.
* `cd frontend && npm install`: Instala React, Vite, TailwindCSS, Lucide React, Solana Wallet Adapter.

---

## F. Configuración `.env`

Crea tu archivo de configuración local copiando el plantilla `.env.example`:

**En Linux / macOS / Git Bash:**
```bash
cp .env.example .env
```

**En Windows PowerShell:**
```powershell
Copy-Item .env.example .env
```

**En Windows CMD:**
```cmd
copy .env.example .env
```

### Tabla de Variables para Modo Seguro del Equipo

| VARIABLE | REQUIRED? | PURPOSE | SAFE TEAM VALUE | SECRET? |
| :--- | :---: | :--- | :--- | :---: |
| `PORT` | Sí | Puerto donde escucha el Backend HTTP | `8080` | No |
| `HOST` | Sí | Dirección IP de bind | `0.0.0.0` | No |
| `DATA_DIR` | Sí | Directorio para almacenamiento de JSON locales | `./data` | No |
| `PAYMENT_RAIL` | Sí | Rail de pago para demo/testing | `fake` | No |
| `SOLANA_CLUSTER` | Sí | Cluster de Solana | `devnet` | No |
| `SOLANA_RPC_URL` | Sí | RPC URL de Solana | `https://api.devnet.solana.com` | No |
| `SOLANA_PROGRAM_ID` | Sí | Program ID del Escrow en Devnet | `HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk` | No |
| `SOLANA_PAYEE_ADDRESS` | Sí | Wallet receptora Payee en Devnet | `9NMAvdKGJibTUFW4mWRfVd4sZRpLNo3fQCQMqdrXXV89` | No |
| `SOLANA_METER_PUBKEY` | Sí | Public key del Meter en Devnet | `3WqaNhVVCCnabBLGA9YWviQHDvo6fTmX1Y9otcmsdB7k` | No |
| `SOLANA_USDC_MINT` | Sí | Mint del USDC SPL token en Devnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | No |
| `TREASURY_MODE` | Sí | Modo del gestor de tesorería | `fake` | No |
| `TREASURY_REAL_ENABLED` | **Sí** | Seguro de protección contra envíos reales | `false` | No |
| `CONNECTIVITY_PROVIDER` | Sí | Adaptador de conectividad eSIM | `fake` | No |
| `FRONTEND_ORIGIN` | Sí | URL autorizada por CORS | `http://localhost:5173` | No |
| `ENABLE_DEMO_TRAFFIC` | Sí | Permite simular tráfico de consumo | `true` | No |

> [!CAUTION]
> **VARIABLES PRODUCTIVAS (NO USAR EN TESTING NORMAL):**
> Variables como `CITRUS_API_KEY`, `POLYGON_TREASURY_PRIVATE_KEY`, y `ARQ_POLYGON_USDC_ADDRESS` están **comentadas y vacías** por defecto en `.env.example`. **NUNCA** coloques claves privadas ni API keys reales en tu archivo `.env` de testing.

---

## G. Cómo Levantar el Backend

Para iniciar el servidor de desarrollo del backend:

```bash
npm run dev
```

* **Puerto predeterminado**: `http://localhost:8080`
* **Healthcheck**: `GET http://localhost:8080/health` (Responde `{"status":"ok"}`)
* **Logs esperados**:
  ```text
  [server] HTTP server listening on http://0.0.0.0:8080
  [fund-flow] Fund flow background job started (interval: 60000ms)
  ```
* **Cómo detener**: Presiona `Ctrl + C` en la terminal.
* **Problemas comunes**: Si la consola muestra `EADDRINUSE: address already in use :::8080`, cambia `PORT=8081` en tu `.env` o detén el proceso anterior.

---

## H. Cómo Levantar el Frontend

En una segunda terminal, dirígete a la carpeta `frontend`:

```bash
cd frontend
npm run dev
```

* **URL Local**: `http://localhost:5173`
* **Dependencia**: Requiere que el backend esté ejecutándose en el puerto 8080.
* **Conexión de Wallet**: Utiliza Phantom o Solflare configurado en la red **Solana Devnet**.

---

## I. Modo Devnet

Al configurar `SOLANA_CLUSTER=devnet`, el backend interactúa directamente con el contrato Anchor en Solana Devnet.

### Direcciones Oficiales de Devnet en el Proyecto
* **Program ID**: `HgrzvLkRfWaH5t4NTaLpv952YXZdzsrmZrC9NZVSoRmk`
* **Config PDA**: `4igZjvwU4sfiu4dsRAzcyk2PqQGBgZqhJ8ddnczXpy3o`
* **Payee Address**: `9NMAvdKGJibTUFW4mWRfVd4sZRpLNo3fQCQMqdrXXV89`
* **Meter Pubkey**: `3WqaNhVVCCnabBLGA9YWviQHDvo6fTmX1Y9otcmsdB7k`
* **USDC Mint (Devnet)**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

---

## J. Modo Fake / Mock

Para testing sin necesidad de depender de APIs ni redes externas:

```env
CONNECTIVITY_PROVIDER=fake
TREASURY_MODE=fake
TREASURY_REAL_ENABLED=false
```

* **Fake Connectivity**: Simula la provisión de eSIMs y actualización de consumo en memoria sin requerir saldo ni API Key en Citrus.
* **Fake Treasury**: Simula el flujo de rebalanceo de liquidez (CCTP, Polygon y ARQ) verificando los límites de `LiquidityPolicy` sin ejecutar transacciones en blockchain ni llamadas HTTP externas.
* **Seguridad**: `Fake Citrus ≠ cargo real`, `Fake Treasury ≠ CCTP real`, `Mock Polygon ≠ transacción real`.

---

## K. Tests Automatizados

La suite de pruebas automatizadas garantiza la integridad del sistema. Ejecuta los siguientes comandos en orden:

```bash
# 1. Tests unitarios e integración del Backend
npm test

# 2. Verificación de tipos TypeScript del Backend
npm run check

# 3. Verificación de tipos y tests del Frontend
cd frontend
npm run typecheck
npm test
cd ..
```

### Baseline Actual del Proyecto
* **Backend**: `276 tests passing`
* **Frontend**: `2 tests passing`
* **TypeScript**: `0 errors` (Clean)

### Cobertura de las Suites
Las pruebas cubren de forma exhaustiva:
* `escrow`: Inicialización, depósito, vouchers, reclamaciones, refund y timeouts.
* `voucher/meter`: Validación de firmas Ed25519 y métricas de consumo de MB.
* `claims/refunds`: Reglas de reclamación mínima y distribución de fondos.
* `Citrus`: Adaptador de API y webhook handler con firmas de seguridad.
* `FundingGate`: Control de bloqueo por saldo insuficiente en el reseller.
* `TreasuryRouter & LiquidityPolicy`: Reglas de rebalanceo atómico en USDC.
* `CCTP v2 & Wormhole Executor`: Flujo de burn y relay cross-chain.
* `Polygon & ARQ`: Estimación dinámica de gas POL y transferencia nativa de USDC.
* `Recovery & Idempotency`: Recuperación de estado tras reinicio sin duplicar operaciones.

---

## L. Checklist de Testing Manual

Usa esta lista de verificación para probar la aplicación de punta a punta en modo seguro:

### Test 1 — Arranque
- [ ] Backend inicia correctamente en `http://localhost:8080`.
- [ ] Frontend inicia correctamente en `http://localhost:5173`.
- [ ] El endpoint `http://localhost:8080/health` responde HTTP 200 `{"status":"ok"}`.

### Test 2 — Wallet
- [ ] Abrir el frontend en la ventana del navegador.
- [ ] Conectar wallet (Phantom / Solflare) ajustada a **Solana Devnet**.
- [ ] La dirección de la wallet se muestra en la interfaz.

### Test 3 — Mission Flow
- [ ] Seleccionar un destino de viaje (ej. Brasil).
- [ ] Crear una nueva misión de conectividad.
- [ ] Aprobar el depósito en Devnet desde la wallet.
- [ ] Confirmar que la misión pasa al estado activa.

### Test 4 — Escrow & Metering
- [ ] Simular consumo enviando datos a la misión (`ENABLE_DEMO_TRAFFIC=true`).
- [ ] Verificar la emisión del voucher de uso firmado por el Meter.
- [ ] Verificar el avance de tranches consumidos.

### Test 5 — Connectivity Fake
- [ ] Confirmar la provisión de la eSIM virtual en la interfaz.
- [ ] Verificar que no se generen errores de autenticación con el proveedor fake.

### Test 6 — Reseller FundingGate (Simulación)
- [ ] Simular evento `balance.auto_refill_failed` en el webhook de Citrus.
- [ ] Verificar que se bloquee la provisión de nuevas eSIMs y recargas.
- [ ] Verificar que las operaciones de `claim`, `close` y `refund` sigan funcionando normalmente.
- [ ] Simular evento `balance.auto_refill_succeeded` y verificar la reactivación automática.

### Test 7 — Treasury Fake Rebalance
- [ ] Verificar que el rebalanceo respete el umbral mínimo (`TREASURY_MIN_TRANSFER_USDC=5`).
- [ ] Verificar que se preserve la reserva local (`TREASURY_KEEP_USDC=5`).
- [ ] Confirmar que no se emitan solicitudes duplicadas de rebalanceo mientras haya fondos en tránsito (`liquidity_in_transit`).

### Test 8 — Recovery & Idempotencia
- [ ] Detener el backend (`Ctrl + C`) en medio de una misión activa.
- [ ] Reiniciar el backend (`npm run dev`).
- [ ] Verificar que el runtime log cargue el estado desde `./data` y continúe sin duplicar transacciones.

---

## M. Qué NO Deben Hacer los Testers

> [!CAUTION]
> ⚠️ **REGLAS DE SEGURIDAD STRICTAS PARA EL EQUIPO**
>
> 1. **NUNCA** cambies `TREASURY_REAL_ENABLED=true` en entornos locales ni de testing.
> 2. **NUNCA** utilices `SOLANA_CLUSTER=mainnet-beta` durante pruebas de desarrollo.
> 3. **NUNCA** coloques claves privadas ni seed phrases reales en archivos `.env`, scripts o logs.
> 4. **NUNCA** envíes USDC real a direcciones de depósito de ARQ ni a Polygon Mainnet.
> 5. **NUNCA** utilices una `CITRUS_API_KEY` productiva con `CONNECTIVITY_PROVIDER=citrus` sin autorización explicita.
> 6. **NUNCA** hagas commit ni push de archivos que contengan secretos o carpetas `data/`.

---

## N. Troubleshooting (Resolución de Problemas Frecuentes)

### 1. `npm install` falla por dependencias
* **Causa**: Conflicto de versiones de Node.js o caché corrupta.
* **Solución**: Limpia la caché con `npm cache clean --force` y asegúrate de estar utilizando Node.js v18 o v20.

### 2. Puerto 8080 en uso (`EADDRINUSE`)
* **Causa**: Otra instancia del backend o proceso local ocupa el puerto.
* **Solución**: En Windows, ejecuta `netstat -ano | findstr :8080` y finaliza el PID con `taskkill /PID <PID> /F`. O bien, asigna `PORT=8081` en tu `.env`.

### 3. Error `Missing .env file` o variables no cargadas
* **Causa**: No se ha creado el archivo `.env` en la raíz.
* **Solución**: Ejecuta `cp .env.example .env` (o `Copy-Item .env.example .env` en PowerShell).

### 4. La Wallet no responde en el Frontend
* **Causa**: La extensión de la wallet está en Mainnet o no tiene permisos.
* **Solución**: Cambia la red de la wallet a **Devnet** en la configuración de Phantom/Solflare y recarga la página.

### 5. Solana RPC Timeout
* **Causa**: Congestión pública en `api.devnet.solana.com`.
* **Solución**: Reintenta la operación o configura un proveedor RPC secundario como Alchemy o QuickNode Devnet en `SOLANA_RPC_URL`.

### 6. Error al recompilar el programa Anchor (`cargo build-sbf`)
* **Causa**: Incompatibilidad de Solana CLI en entorno Windows nativo.
* **Solución**: Compila el contrato exclusivamente dentro de **WSL2 (Ubuntu)** o utiliza el binario desplegado previamente en Devnet.

---

## O. Cómo Reportar Bugs

Si encuentras algún fallo durante el testing, reporta el problema abriendo un issue o enviando un reporte con el siguiente formato estándar:

```text
Branch: feature/cctp-arq-treasury
Commit: <git rev-parse --short HEAD>
OS: <Windows 11 / macOS Sonoma / Ubuntu 22.04>
Node version: <node --version>
npm version: <npm --version>

Command executed:
<comando ejecutado>

Expected result:
<comportamiento esperado>

Actual result:
<comportamiento obtenido>

Error / Stack trace:
<copia limpia de los logs de error>

Steps to reproduce:
1. ...
2. ...
3. ...
```

> [!NOTE]
> Jamás incluyas valores de tu `.env`, claves privadas ni tokens Bearer en las capturas o reportes de errores.

---

## P. Arquitectura Técnica

### Módulos Principales del Código Fuente

* [`src/jobs/fund-flow.ts`](file:///c:/RenderByte/astroam-solana/src/jobs/fund-flow.ts): Orquestador central del ciclo de fondos, vouchers y rebalanceo de tesorería.
* [`src/product/services/MissionProductService.ts`](file:///c:/RenderByte/astroam-solana/src/product/services/MissionProductService.ts): Lógica de negocio de misiones de conectividad y ciclo de vida de uso.
* [`src/solana/EscrowChain.ts`](file:///c:/RenderByte/astroam-solana/src/solana/EscrowChain.ts): Cliente Web3/Anchor para interactuar con el Escrow en Solana.
* [`src/services/CitrusWebhookHandler.ts`](file:///c:/RenderByte/astroam-solana/src/services/CitrusWebhookHandler.ts): Procesador de webhooks entrantes de Citrus (eventos de recarga y saldo).
* [`src/services/ResellerFundingGate.ts`](file:///c:/RenderByte/astroam-solana/src/services/ResellerFundingGate.ts): Control de estado operativo del reseller para pausar/reanudar servicios.
* [`src/treasury/`](file:///c:/RenderByte/astroam-solana/src/treasury/):
  * `LiquidityPolicy.ts`: Reglas de buffers y cálculo atómico en USDC.
  * `TreasuryRebalancer.ts`: Único punto de entrada para decidir y ejecutar rebalanceos.
  * `TreasuryRouter.ts`: Enrutador hacia adaptadores CCTP/Polygon/ARQ.
  * `CctpArqTreasury.ts`: Implementación de CCTP v2 + Wormhole Executor + Polygon EOA → ARQ.
  * `PolygonArqAdapter.ts`: Adaptador EOA Polygon para transferencia nativa de USDC ERC20 con gas POL estimado dinámicamente.
* [`programs/astroam-escrow/`](file:///c:/RenderByte/astroam-solana/programs/astroam-escrow/): Código fuente del programa smart contract en Rust (Anchor framework).

---

## Q. Estado de las Integraciones Externas

1. **Circle CCTP v2**: Código implementado y validado con mocks unitarios e integrados. Pendiente prueba en vivo con fondos reales en Mainnet.
2. **Wormhole Executor**: Cliente HTTP implementado conforme a la especificación oficial v0 (`/v0/quote` y `/v0/status/tx`). Pendiente prueba en vivo en Mainnet.
3. **Polygon Native USDC**: Adaptador ERC20 implementado con estimación dinámica de gas en POL (`estimateGas` + `getFeeData`). Pendiente prueba en vivo en Mainnet.
4. **ARQ Deposit Address**: Formato y lógica de acreditación implementados. La dirección de depósito se configura mediante variable de entorno `ARQ_POLYGON_USDC_ADDRESS`.
5. **ARQ Card**: Tarjeta corporativa virtual gestionada en la plataforma de ARQ.
6. **Citrus API**: Adaptador oficial para API de Reseller y procesador de webhooks listos para producción.
7. **Citrus Real Testing**: No requerido para testing normal del equipo (utilizar `CONNECTIVITY_PROVIDER=fake`).
8. **Kamino / Yield**: Integración diferida por diseño.

---

## R. Git Workflow para Testers

Para realizar pruebas o experimentos sin alterar el trabajo base:

1. **No trabajes directamente sobre `main` ni `feature/cctp-arq-treasury`.**
2. Para probar o realizar ajustes locales, crea tu propia rama a partir de `feature/cctp-arq-treasury`:
   ```bash
   git switch feature/cctp-arq-treasury
   git switch -c test/nombre-del-tester
   ```
3. Realiza tus cambios y pruebas en tu rama dedicada `test/<nombre>`.
4. Si encuentras sugerencias o correcciones, abre un Pull Request hacia `feature/cctp-arq-treasury`.

---
*Documentación generada para AstroAm Treasury & Conectividad — Octubre 2026.*
