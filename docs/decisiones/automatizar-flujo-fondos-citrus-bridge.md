# Decisión: Citrus + Bridge para automatizar el flujo de fondos

**Fecha:** 5/10/2026 · **Estado:** el escrow (clave de sesión y claims), el
fondeo por tramos, el cobro y el cierre automáticos están implementados y con
tests; el programa actualizado todavía no se desplegó en devnet. Bridge, la
tarjeta de Citrus y la prueba con una eSIM real siguen pendientes (§6).

> **Actualización 5/10/2026.** La auto-recarga de Citrus no funciona como se
> supone más abajo: solo la dispara un gasto real (crear una eSIM), no el
> fondeo de una eSIM. Lo que dice su documentación, la arquitectura que
> resulta y las opciones están en
> [`arquitectura-flujo-de-fondos.md`](arquitectura-flujo-de-fondos.md).

Esta decisión **reemplaza y extiende** la propuesta de la rama
`docs/automatizar-flujo-de-fondos`
(`docs/decisiones/automatizar-flujo-de-fondos.md`). Aquella dejó abierto el
riel de tesorería (USDC cobrado → USD de la cuenta reseller). Esta lo cierra:
**Bridge** liquida USDC de Solana a la cuenta bancaria de AstroAm, y esa
cuenta respalda la **tarjeta guardada** con la que Citrus se auto-recarga.
El escrow sigue con clave de sesión y tramos chicos. No cambia código de la
app.

Contexto de producto ya decidido: medición con el proveedor
([`medicion-con-proveedor.md`](medicion-con-proveedor.md)) y el modelo Citrus
([`../citrus-mobile-brief.md`](../citrus-mobile-brief.md)).

## 1. Problema

AstroAm vende datos móviles prepago. El viajero deposita **USDC de Circle**
en un escrow de Solana. El uso se mide off-chain. Un cierre paga a AstroAm
lo usado y devuelve el resto al viajero en la misma transacción.

Citrus (proveedor eSIM wholesale) cobra en **dólares vía Stripe**. No acepta
USDC ni otra crypto. No hay top-up del saldo reseller por API: la recarga es
por el developer dashboard, con mínimo de ~$10 en la documentación reseller.
Fondear eSIMs sí es API: `POST /esim/{iccid}/fund`. Los grupos de saldo
compartido también descuentan del saldo reseller.

Sí existe **auto-recarga con tarjeta guardada** cuando baja el saldo de un
grupo compartido (`group.balance_low`, auto-refill del account). Los eventos
de la cuenta reseller incluyen `balance.auto_refill_succeeded` y
`balance.auto_refill_failed` (ver el brief).

La eSIM del viajero tiene que seguir **standalone**. Una SIM dentro de un
grupo no tiene wallet ni consumo individual
(`wallet_balance_usd` y `total_data_charged_usd` vienen `null`), y el
producto factura por usuario. El auto-refill es el mecanismo de la cuenta,
no un motivo para meter al viajero en un grupo. Si la auto-recarga también
se dispara cuando baja el saldo reseller **sin** un grupo compartido, queda
**desconocido**: hay que confirmarlo con Citrus (paso (d)).

Documentación: [citrusmobile.com/developer/docs](https://citrusmobile.com/developer/docs).
Soporte: support@citrusmobile.com.

Hoy el lazo no cierra solo. AstroAm adelanta USD a la eSIM y recién cobra
USDC al `close`. El USDC cobrado no vuelve solo a dólares, y el dashboard de
Citrus hay que cargarlo a mano.

## 2. Solución recomendada

**Bridge** ([bridge.xyz](https://bridge.xyz)) crea una *liquidation address*
en **Solana / USDC** que apunta a la cuenta bancaria de AstroAm. Cuando llega
USDC, Bridge convierte y deposita USD por ACH, wire o FedNow. La creación de
la address y el ruteo son por API.

- Mínimo publicado: **~$1** en la ruta Solana USDC → USD por ACH
  ([payment routes](https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes)).
- Comisión de orquestación **orientativa ~0,25%**, más el costo del rail.
  ACH es casi cero. El costo exacto de wire y de FedNow, y el plazo de cada
  riel, quedan **desconocidos** hasta abrir la cuenta. No se fijan otras
  comisiones en esta decisión.
- Referencia de la address:
  [Liquidation address](https://apidocs.bridge.xyz/platform/orchestration/liquidation_address/liquidation_address).

Ese banco paga y respalda la **tarjeta guardada** de la auto-recarga de
Citrus. El loop queda así:

```
Viajero ─USDC─▶ Escrow Solana
                    │ depósito (una firma)
                    ▼
              backend provisiona la eSIM
              y fondea un tramo chico
              POST /esim/{iccid}/fund
                    │
                    ▼
         saldo reseller de Citrus ──auto-refill──▶ tarjeta guardada
                    ▲                                    │
                    │                                    ▼
              USD en el banco ◀── Bridge liquida USDC
                    ▲              (treasury / close del escrow)
                    │
              close: paga lo usado, devuelve el resto
```

1. El viajero deposita USDC en el escrow.
2. El backend provisiona (o reutiliza) la eSIM y fondea tramos chicos por la
   API de Citrus, descontando el saldo reseller.
3. Cuando la cuenta de Citrus baja, la auto-recarga con tarjeta repone el
   saldo. No hace falta un top-up manual en el dashboard, una vez
   configuradas la tarjeta y la auto-recarga.
4. Al cerrar el escrow (y en el barrido de tesorería), el USDC cobrado se
   manda a la liquidation address. Bridge deposita USD en el banco que
   respalda esa tarjeta.

El loop de la eSIM queda automático. Lo que sigue siendo manual, hasta los
pasos de abajo, es abrir Bridge, guardar la tarjeta y prender la
auto-recarga.

## 3. Alternativas evaluadas

**Circle Mint** ([docs](https://developers.circle.com/circle-mint),
[circle.com](https://www.circle.com)). USDC en Solana → pago al banco por
wire o RTP, por API. Encaja en el mismo lugar que Bridge. Es más enterprise
y pide KYB. Bridge es más liviano para una liquidation address permanente.
Comisiones y plazos de Circle Mint: **desconocidos** acá.

**Rain** ([rain.xyz](https://www.rain.xyz)). Visa virtual fondeada con USDC,
incluida Solana. Esa tarjeta podría pagar el Stripe de Citrus directo, sin
el paso banco → tarjeta. Es el camino más limpio de punta a punta y también
el que más KYC y programa de tarjetas exige. Comisiones: **desconocidas**.

**Cryptorefills** ([cryptorefills.com](https://www.cryptorefills.com),
[solana.x402.cryptorefills.com](https://solana.x402.cryptorefills.com)).
Cobra USDC en Solana por API o x402 y no exige saldo prepago del reseller.
Al comprar cobra el producto entero: se pierde el pago por MB y el reembolso
del saldo no usado. Comisiones: **desconocidas**.

**ZeroID** ([zeroid.to/reseller](https://zeroid.to/reseller)). Prepago con
mínimo ~$300 en SOL o USDT. No es el modelo de pago por MB con devolución de
lo no usado.

## 4. Escrow (Solana)

El programa (`programs/astroam-escrow`) hoy exige que el `close` lleve la
firma del viajero. El `refund` a los 7 días (`SOLANA_TIMEOUT_SECONDS`)
devuelve **todo** el depósito si nadie cerró. AstroAm pierde lo que ya
fondeó en Citrus. Lo mismo en un viaje de más de 7 días: el viajero puede
consumir y después reclamar el reembolso completo.

**Producto.** Al depositar se registra una **clave de sesión**. El viajero
firma una sola vez. El backend cierra con esa clave. El tope sigue siendo el
depósito.

**Tramos de $2–$3.** Solo se fondea el tramo siguiente en Citrus cuando un
vale cubre el anterior, y lo fondeado entra en el depósito. Si el viajero
desaparece, la pérdida máxima de AstroAm es **un tramo** (Citrus corta los
datos cuando la wallet de la eSIM llega a $0).

**Demo.** Firmas periódicas con Phantom, sin cambiar el programa. Alcanza
para mostrar el ciclo. No escala: cada tramo es un popup y, con la app
cerrada, no hay firma.

**Producto = clave de sesión + claims parciales.** Un `claim` transfiere a
AstroAm lo acumulado hasta ese momento sin cerrar el escrow, así el timeout
deja de amenazar los viajes largos. El riesgo baja a lo consumido desde el
último claim (en la práctica, un tramo).

**Yield (opción abierta, sin implementar).** Mientras el USDC está en el
escrow se puede evaluar lending en Solana, por ejemplo **Kamino** o
**Marginfi**, para generar yield. No se implementa en esta decisión. Queda
abierto **a quién va el yield** (viajero o plataforma). El riesgo de
liquidez, el plazo en que los fondos no se pueden retirar y el impacto en el
`refund` de 7 días están **desconocidos** hasta un diseño aparte (paso (e)).

## 5. Decisión

Quedarse con **Citrus + Bridge + auto-recarga con tarjeta + clave de sesión
con tramos**.

No cambiar a Cryptorefills ni a ZeroID mientras el diferenciador sea
reembolsar los MB no usados. Circle Mint y Rain siguen siendo alternativas
válidas si Bridge no pasa KYB o si conviene pagar Stripe con una Visa
fondeada en USDC; no son el camino por defecto.

Próximos pasos:

1. Abrir la cuenta Bridge y crear la liquidation address Solana / USDC hacia
   el banco de AstroAm.
2. Configurar en Citrus la tarjeta guardada y la auto-recarga.
3. Especificar el cambio del programa de escrow: clave de sesión al
   depositar y claims parciales. El demo puede seguir con firmas Phantom.
4. Escribir a support@citrusmobile.com y preguntar si el reseller acepta
   wire, ACH o crypto, y si la auto-recarga del account se dispara sin un grupo
   compartido (las eSIM de viajero tienen que seguir standalone).
5. Evaluar yield en Kamino o Marginfi en un diseño aparte, incluido a quién
   se lo asigna.

## 6. Estado de la implementación

Hecho en el código:

- **Programa** (`programs/astroam-escrow`): `deposit` acepta una clave de
  sesión; `claim` cobra la parte del vale no cobrada y deja el escrow abierto;
  `close` no puede bajar de lo ya cobrado; el timeout corre desde el depósito,
  el último `topUp` o el último `claim`, y el `refund` devuelve lo no cobrado.
  Los escrows del primer despliegue (sin clave de sesión) se siguen pudiendo
  cerrar y reembolsar después de actualizar el programa.
- **App** (`frontend/src/chain/session.ts`): genera la clave de sesión al
  depositar, la guarda en el navegador y firma el vale después de cada
  lectura. La clave vive en el navegador, no en el backend: AstroAm nunca
  puede firmar un monto por el viajero.
- **Backend**: guarda el vale más alto (`POST /api/missions/:id/vouchers`),
  fondea la eSIM un tramo por delante del vale, cobra con `claim`, cierra con
  `close` y barre lo cobrado a `BRIDGE_LIQUIDATION_ADDRESS`
  (`src/product/services/fund-flow.ts`, `src/jobs/fund-flow.ts`,
  `src/solana/EscrowChain.ts`). Con la clave de operador el depósito se lee
  del escrow, no del pedido.

Diferencias con lo escrito arriba:

- **Tramo.** No se espera a que un vale cubra el tramo anterior entero, porque
  la wallet de la eSIM llegaría a $0 y Citrus cortaría los datos antes de
  fondear el siguiente. La regla es que lo fondeado nunca pase de lo que
  cubren los vales más un tramo. La pérdida máxima sigue siendo un tramo.
- **Cierre sin vale.** Si el viajero deposita y nunca firma un vale, el
  backend no puede cerrar: ni un vale por cero se puede firmar por él. Ese
  depósito vuelve por el `refund` del timeout.
- **Uso después del último vale.** Con la app cerrada no se firman vales. El
  cierre automático usa el último vale que tiene, así que lo consumido
  después se pierde (como mucho, un tramo).

Pendiente, fuera del código: los pasos 1, 2, 4 y 5 de §5; desplegar el
programa actualizado (`npm run solana:upgrade`, con la clave que lo
desplegó); y la prueba con una eSIM real. Los webhooks de Citrus
(`esim.balance_depleted`, `esim.defunded`) no están conectados al flujo: hoy
se entera por la lectura periódica.

## Enlaces

- Bridge: https://bridge.xyz
- Liquidation address: https://apidocs.bridge.xyz/platform/orchestration/liquidation_address/liquidation_address
- Payment routes (mínimos por riel): https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes
- Circle Mint: https://developers.circle.com/circle-mint
- Rain: https://www.rain.xyz
- Cryptorefills: https://www.cryptorefills.com
- ZeroID reseller: https://zeroid.to/reseller
- Citrus developer docs: https://citrusmobile.com/developer/docs
