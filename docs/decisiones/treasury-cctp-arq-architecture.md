# Decisión de Arquitectura: Tesorería con Circle CCTP V2, Wormhole Executor y Polygon

**Fecha:** 7/10/2026  
**Estado:** CCTP V2 + Wormhole Executor Implementado, Pruebas Unitarias Ejecutadas con Mocks, Envíos Mainnet No Ejecutados  
**Reemplaza:** Diseño preliminar basado en Bridge.xyz (`automatizar-flujo-fondos-citrus-bridge.md`)

---

## 1. Resumen de Estado

| Componente | Estado de Implementación |
| --- | --- |
| **Solana CCTP v2 source adapter** | **IMPLEMENTED** (`SolanaCctpBridge` con V2 TokenMessengerMinter) |
| **Wormhole Executor request** | **IMPLEMENTED** (Instrucción `requestForExecution` integrada en fuente) |
| **CCTP message extraction** | **IMPLEMENTED** (`extractCctpMessageFromTransaction` extrae `cctpMessage` y `cctpMessageHash`) |
| **Executor status tracking** | **IMPLEMENTED** (`ExecutorClient` con fail-closed en `getExecutionStatus`) |
| **Polygon redemption detection** | **IMPLEMENTED** (Evidencia verificable `destinationTxHash` requerida para `completed`) |
| **Mainnet execution** | **NOT PERFORMED** (No se han movido ni quemado fondos reales en mainnet) |
| **Polygon EOA → ARQ real transfer** | **NOT IMPLEMENTED** (Recipiente actual: `POLYGON_TREASURY_EOA`) |
| **Yield strategy** | **INTERFACE / NOOP ONLY** (`NoopYieldStrategy` / `FakeYieldStrategy`) |
| **Bridge.xyz** | **SUPERSEDED** (Obsoleto / Reemplazado) |

---


## 2. Diagrama de Flujo

```
[ Solana Escrow ] 
       │ (claims / cobros cobrados en Solana USDC)
       ▼
[ AstroAm Payee Wallet ]
       │ (getPayeeBalanceAtomic read-only balance + TreasuryRouter)
       ▼
[ TreasuryTransferStore (Journal persistente en DATA_DIR) ]
       │ (idempotencia y crash recovery)
       ▼
[ Circle CCTP (Cross-Chain Transfer Protocol) ]
       │ (Burn de USDC nativo en Solana)
       │ (Wormhole Automatic CCTP Relayer)
       ▼
[ Native Circle USDC en Polygon ]
       │
       ▼
[ Polygon Treasury EOA ] (Wallet intermedia de control)
       │
       ▼
[ ARQ Deposit Address ] (Plataforma ARQ en Polygon)
       │
       ▼
[ ARQ Global Fiat Account / Citrus Reseller Refill ]
```

---

## 3. Componentes y Capas

### A. Abstracción `TreasuryRouter` y `TreasuryTransferStore`
Toda la lógica de movimiento de fondos entre la wallet de cobro (`Payee`) y la tesorería externa se abstrae detrás de la interfaz `TreasuryRouter`:
- `DisabledTreasury`: (Default, Fail-closed) El USDC cobrado permanece en la wallet de cobro de Solana.
- `FakeTreasury`: Implementación en memoria utilizada para pruebas unitarias y entornos de desarrollo/demo.
- `CctpArqTreasury`: Implementación de producción que registra las transferencias en `TreasuryTransferStore` (journal persistente atómico en `DATA_DIR`) antes de la quema en Solana. Ante un reinicio o caída del servidor, reanuda la operación sin duplicar el `burn`.

### B. Circle CCTP vs Bridges Tradicionales
- **Sin Wrapped Tokens:** CCTP quema el USDC nativo en la cadena origen (Solana) y acuña USDC nativo emitido directamente por Circle en la cadena destino (Polygon). No se utiliza USDC.e ni depósitos sintéticos.
- **Relayer Automático:** Diseñado para utilizar el módulo `Automatic CCTP` del SDK de Wormhole.

### C. Protección de Seguridad de Red ("Network Safety Fail-Hard")
- Se prohíbe explícitamente cualquier combinación de **Solana devnet** con **CCTP o ARQ real en mainnet**.
- Si el servidor se inicia con `TREASURY_MODE=cctp-arq` y la configuración no es 100% válida para producción mainnet (`TREASURY_REAL_ENABLED=true`, `SOLANA_CLUSTER=mainnet-beta`, `POLYGON_NETWORK=mainnet`, dirección EVM de ARQ válida), el servidor **LANZA UN ERROR EXPLÍCITO (FAIL-HARD)** durante el startup impidiendo el inicio.

### D. Reseller Funding Gate de Citrus
Integrado para responder a los eventos de webhook de Citrus:
- Evento `balance.auto_refill_failed`: Activa el freno de mano (`ResellerFundingGate`). Detiene la emisión de **nuevas eSIMs** y el fondeo de **nuevos tramos de datos**, pero **NO detiene** los checkpoints, claims, cierres ni devoluciones de escrow en Solana.
- Eventos `balance.auto_refill_succeeded` / `balance.topped_up`: Reanudan automáticamente la emisión y el fondeo.

---

## 4. Estado de Bridge.xyz

La documentación e implementación previa referente a `Bridge.xyz` y `BRIDGE_LIQUIDATION_ADDRESS` se marca como **diseño histórico / superseded**. No debe utilizarse en despliegues actuales.

---

## 5. Seguridad de Journal y DATA_DIR

- **Regla Estricta de Git:** `runtime DATA_DIR must be ignored by Git`. Ningún archivo de estado runtime (`treasury-transfers.jsonl`, `.tmp`, registros de sesión o llaves) debe ser trackeado ni incluido en commits.
- **Sensibilidad de Material Acciónable:** El journal guarda `sourceTxSignature` y transacciones serializadas pre-firmadas (`serializedTransaction`) para permitir retransmisión idempotente tras caídas del servidor. Aunque **nunca contiene claves privadas**, una transacción serializada firmada es material accionable en la red.
- **Aislamiento en Logs:** Los logs estructurados del servidor tienen prohibido incluir el campo `serializedTransaction` o los bytes del payload pre-firmado.
- **Restricción de Acceso:** El directorio de ejecución `DATA_DIR` debe configurarse con permisos restringidos de sistema operativo (por ejemplo, `chmod 700`) en entornos de producción.

