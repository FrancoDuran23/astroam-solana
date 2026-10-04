# Propuesta: automatizar el flujo de fondos entre el escrow y Citrus

**Fecha:** 4/10/2026 · **Estado:** propuesta, sin implementar

**Contexto.** El viajero paga en USDC en Solana y Citrus Mobile cobra en USD
desde la cuenta de reseller de AstroAm, cargada con Stripe. Citrus no acepta
USDC ni lee el escrow, así que AstroAm es el intermediario: adelanta USD a la
eSIM y cobra en USDC al cerrar el escrow (ver
[`medicion-con-proveedor.md`](medicion-con-proveedor.md) y
[`../citrus-mobile-brief.md`](../citrus-mobile-brief.md)).

## Problema actual

1. **Solo el viajero puede habilitar el cobro.** `close` exige un vale firmado
   por la misma clave que depositó (`programs/astroam-escrow/src/lib.rs`,
   `signer != state.traveler`). Hoy esa firma la pide Phantom en el momento de
   cerrar (`frontend/src/chain/solana.ts`). AstroAm no tiene ningún vale
   firmado hasta ese momento.
2. **El reembolso por timeout le devuelve todo al viajero.** `refund` se
   habilita a los `SOLANA_TIMEOUT_SECONDS` (7 días) desde `opened_at` y
   transfiere el depósito entero. Si el viajero no cierra, AstroAm pierde todo
   lo que ya fondeó en Citrus. También pasa en viajes de más de 7 días: el
   viajero puede consumir y después reclamar el reembolso completo.
3. **Nada corre solo.** El lazo de medición (`src/jobs/usage-loop.ts`) y
   `FundingService` no se montan con el servidor; la medición y el fondeo
   quedan en manos de quien opera (`docs/citrus-mobile-spec.md`, D5).
   Tampoco hay quien escuche los depósitos on-chain para provisionar la eSIM.
4. **La tesorería es manual.** El USDC cobrado no vuelve solo a la cuenta de
   reseller en USD.

Lo que limita el riesgo hoy: Citrus corta los datos cuando la wallet de la
eSIM llega a $0, así que la pérdida máxima es lo que se haya fondeado.

## Flujo objetivo

```
Viajero ─USDC─▶ Escrow ── backend detecta el depósito
                             │
                             ▼
        Cuenta reseller (USD) ─tramos─▶ eSIM ─consumo─▶ red
                ▲                                         │ cada ~10 min
                │                                         ▼
     Tesorería USDC → USD ◀── close ◀── vale acumulativo firmado
                                │
                                └─▶ el resto vuelve al viajero
```

1. **Depósito.** El viajero firma una vez.
2. **Arranque.** El backend ve el depósito, provisiona o reutiliza la eSIM,
   guarda el `total_data_charged_usd` de partida y fondea el primer tramo.
3. **Medición.** Cada ~10 min: consumo del viaje × `MARKUP` → vale
   acumulativo firmado. El tramo siguiente se fondea solo si hay un vale que
   cubre lo ya fondeado y lo fondeado × `MARKUP` entra en el depósito.
4. **Cierre.** Por pedido del viajero, inactividad, saldo agotado o cercanía
   del timeout: `defund` en Citrus, lectura final y `close` con el último
   vale. El resto vuelve al viajero en la misma transacción.
5. **Tesorería.** En lote: USDC cobrado → USD → cuenta de reseller.

Para que el paso 3 sea automático, AstroAm necesita **vales firmados sin
intervención del viajero**. Eso define las opciones.

## Opciones para firmar los vales

### A. Clave de sesión registrada en el escrow (recomendada)

Al depositar, la app genera un keypair efímero y su pubkey se guarda en el
escrow (`deposit` recibe un campo más). `close` acepta un vale firmado por
`state.traveler` **o** por `state.session_key`. La app firma un vale nuevo en
cada lectura y lo manda al backend; AstroAm puede cerrar cuando quiera.

- A favor: experiencia de una sola firma. El tope sigue siendo el depósito
  (`cumulative > state.deposit` ya se rechaza) y la clave sirve para ese
  escrow nomás. Es el patrón de "session keys" habitual en Solana.
- En contra: requiere cambiar el programa y redesplegar. Si la app está
  cerrada, no se firman vales; el riesgo queda en lo fondeado desde el último
  vale (un tramo). Si la clave vive en el backend en vez del navegador, el
  viajero confía en AstroAm por hasta su depósito.

### B. El viajero firma vales periódicos con su wallet

Sin cambios en el programa: la app pide `signMessage` a Phantom cada N
minutos o antes de cada tramo.

- A favor: cero cambios on-chain. Sirve para el demo.
- En contra: un popup de wallet cada tramo. Con la app en segundo plano no
  hay firma y el fondeo se frena. No escala como producto.

### C. Liquidaciones parciales on-chain

Agregar una instrucción `claim` que, con un vale firmado (por el viajero o
una clave de sesión), transfiera a AstroAm lo acumulado hasta ese momento sin
cerrar el escrow. AstroAm cobra por tramos en vez de al final.

- A favor: el riesgo de AstroAm baja a lo consumido desde el último `claim`.
  El timeout deja de ser una amenaza para viajes largos.
- En contra: una transacción por tramo (centavos en Solana). Más estado en el
  programa (`claimed`). Se combina con A, no la reemplaza.

### D. AstroAm como firmante autorizado del monto

El programa le permite al payee cerrar con el monto que declare, hasta el
depósito.

- A favor: lo más simple de automatizar.
- En contra: el viajero vuelve a confiar en AstroAm, que es justo lo que el
  producto promete evitar. Descartada.

## Otros cambios necesarios

| Pieza | Cambio |
|---|---|
| Timeout | Que no corra desde `opened_at` fijo: extenderlo con cada `topUp` o `claim`, o cerrar automáticamente antes del vencimiento. |
| Escucha de depósitos | Suscripción a los logs o cuentas del programa → provisión y primer fondeo. |
| Lazo de medición | Montar `usage-loop` y `FundingService` en `server/main.ts`. |
| Vigilancia de cierre | Job que cierra por inactividad, saldo agotado o día 6 de 7. |
| Webhooks de Citrus | `esim.balance_depleted` y `esim.defunded` para reaccionar sin esperar el polling. |
| Tesorería | USDC → USD en lote (Circle Mint, Bridge o un exchange) y auto-refill de la cuenta de reseller. |
| Tamaño del tramo | Chico ($2 a $3) y con margen para el retraso de 10 a 15 min del reporte de Citrus. |

## Recomendación

1. **Demo (ya):** opción B, sin tocar el programa. Alcanza para mostrar el
   ciclo completo.
2. **Producto:** opción A + C. Clave de sesión para firmar sin popups y
   `claim` parcial para que el riesgo de AstroAm sea a lo sumo un tramo. Con
   el timeout extendido en cada `claim` se cubren viajes largos.
3. **Siempre:** fondear la eSIM en tramos chicos y solo con un vale que cubra
   el tramo anterior.

## Pendiente de verificar

- La prueba con una eSIM real en Citrus (T9 de la spec): precisión de
  `total_data_charged_usd`, formato de la firma de los webhooks y fin del
  `defund`.
- Si Citrus acepta otros medios de pago o USDC para cargar la cuenta de
  reseller (consultar a support@citrusmobile.com).
- Costo y plazo de la conversión USDC → USD con el proveedor que se elija.
