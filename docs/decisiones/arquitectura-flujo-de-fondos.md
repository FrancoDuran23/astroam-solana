# Arquitectura del flujo de fondos: qué permite Citrus y qué opciones hay

**Fecha:** 5/10/2026 · **Estado:** análisis y opciones. El escrow con clave de
sesión y claims ya está en `main`; lo demás de este documento no está
construido, salvo donde se dice.

Sigue a [`automatizar-flujo-fondos-citrus-bridge.md`](automatizar-flujo-fondos-citrus-bridge.md).
Aquella decisión daba por hecho que Citrus recarga solo el saldo reseller con
la tarjeta guardada. Acá está lo que dice su documentación y su dashboard, la
arquitectura que resulta, tres opciones para la plata y la comparación con
otros proveedores.

## 1. Qué es el saldo reseller

Es la plata en dólares cargada en la cuenta de Citrus: **un solo pozo para
toda la cuenta**. Con una cuenta se manejan todas las eSIM. Del pozo salen dos
cosas:

- **$1,75 cada vez que se crea una eSIM.** Es gasto.
- **Lo que se le pasa a cada eSIM** (`POST /esim/{iccid}/fund`, de $0,01 a
  $10.000). Cada eSIM tiene su propia billetera; el viajero consume de ahí, no
  del pozo. Es una transferencia, no gasto.

Al cerrar un viaje, `POST /esim/{iccid}/defund` devuelve al pozo lo que la
eSIM no usó (tarda unos 15 minutos).

Ejemplo con 3 viajeros y $100 en el pozo:

| Paso | Saldo reseller | eSIM 1 | eSIM 2 | eSIM 3 |
|---|---|---|---|---|
| Arranque | $100 | | | |
| Se crean 3 eSIM | $94,75 | $0 | $0 | $0 |
| Primer tramo a cada una ($2,50) | $87,25 | $2,50 | $2,50 | $2,50 |
| El viajero 1 gasta y recibe otro tramo | $84,75 | $2,50 | $2,50 | $2,50 |
| El viajero 2 cierra habiendo usado $1 | $86,25 | $2,50 | $0 | $2,50 |

## 2. Qué es automático en Citrus y qué no

Fuentes: [referencia completa](https://citrusmobile.com/llms-full.txt),
[OpenAPI](https://citrusmobile.com/openapi-reseller.yaml) y la pantalla de
auto-recarga del dashboard, leídas el 5/10/2026.

**Automático, por API** (lo que usa el backend):

- Crear, activar, pausar, limitar y terminar una eSIM.
- Fondear una eSIM y recuperar lo que no usó.
- Leer el saldo y el gasto de cada eSIM, el saldo de la cuenta
  (`GET /wallet/balance`) y las tarifas.
- Avisos por webhook: `balance.low` (el saldo baja de $5), `balance.depleted`
  ($0), `balance.topped_up`, `balance.auto_refill_succeeded` y
  `balance.auto_refill_failed`.
- Límite: 100 pedidos por minuto.

**No hay API para cargar el saldo reseller.** Se carga desde el dashboard, con
tarjeta por Stripe, mínimo $10.

**Auto-recarga** (se configura en el dashboard):

- Se elige un umbral y un monto: "cuando el saldo baje de $X, cobrar $Y" a la
  tarjeta guardada en la primera carga.
- Se dispara una vez por cruce, cuando el saldo pasa de arriba a abajo del
  umbral, y una vez al prenderla si ya está por debajo.
- **Solo la dispara un gasto real.** Mover plata a la billetera de una eSIM o
  de un grupo es una transferencia y nunca cobra la tarjeta. Para AstroAm el
  único gasto real es crear una eSIM.
- Si el cobro falla (tarjeta rechazada, 3DS), se apaga sola. Para prenderla
  de nuevo hay que hacer una carga manual.
- Tope: 10 cobros en 24 horas; después se apaga sola.

**Saldo en cero:** las eSIM ya fondeadas siguen andando. Fallan los fondeos
nuevos, con `402`.

**Grupos de saldo compartido:** no sirven para AstroAm. Dentro de un grupo no
hay consumo por eSIM (`total_data_charged_usd` viene `null`) y hay un máximo
de 10 grupos.

**El MCP de Citrus** (`https://citrusmobile.com/api/mcp`) es la misma cuenta
para un agente de IA, con nueve herramientas: cuatro públicas (tarifas,
cobertura, estimar costo, buscar en la documentación) y cinco con clave (ver
la cuenta, listar eSIMs, ver una, crear una y fondearla). No pausa, no
termina, no maneja grupos ni avisos. Tampoco carga saldo.

### Sin confirmar

Qué pasa cuando los tramos dejan el saldo por debajo del umbral (sin disparar
nada) y después se crea una eSIM: esa creación puede cobrar la tarjeta o no,
porque el cruce ya ocurrió. Se confirma con una prueba que cuesta $1,75 más
la recarga, que queda como saldo.

## 3. Arquitectura con lo que Citrus permite

Entre la tesorería en Solana y Citrus no hay camino directo. El puente es la
tarjeta.

```
 EN SOLANA · USDC

 Viajero ──depósito──▶ Escrow ──claim / close──▶ Tesorería
    ▲                    │                           │
    └──── lo no usado ───┘                           │ lo que hace falta
                                                     ▼
 EN DÓLARES · USD                              Bridge / exchange
                                                     │
 eSIM ◀──tramos $2,50── Saldo reseller ◀──cobra── Tarjeta ◀── Banco
   │                         ▲
   └──── lo que sobra ───────┘        Backend: vigila el saldo y avisa
```

Lo que hace el backend solo:

1. El escrow cobra por tramos (`claim`) hacia la tesorería. **En `main`.**
2. Crea la eSIM y le fondea cada tramo desde el saldo reseller, como mucho un
   tramo por delante de lo que cubren los vales. **En `main`.**
3. Al cerrar, pide el `defund` y lo que sobró vuelve al saldo reseller.
   **En `main`.**

Lo que no está construido:

4. Leer el saldo de Citrus y avisar cuando baja de un umbral propio. El aviso
   de Citrus llega recién a los $5.
5. Escuchar `balance.auto_refill_failed` y avisar.
6. Frenar los viajes nuevos cuando el saldo está bajo, para no aceptar un
   depósito que no se puede atender.

El punto débil es la tarjeta: un solo rechazo apaga la auto-recarga hasta que
alguien la prenda a mano.

## 4. Tres opciones para la plata

| | A · Hoy en `main` | B · El escrow rinde | C · Rinde la tesorería |
|---|---|---|---|
| Plata quieta | No rinde | Rinde en el escrow | Rinde en la tesorería |
| Reembolso del viajero | Lo garantiza el programa | Depende del money market | Lo garantiza el programa |
| Qué pasa a dólares | Todo lo cobrado | Solo lo necesario | Solo el costo de Citrus |
| Cambios al programa | Ninguno | Grandes | Ninguno |
| Quién custodia lo cobrado | La clave del servidor | A definir | Multisig con límite |
| Estado | Construido | Por construir, grande | Por construir, chico |

**A.** Lo cobrado llega a la wallet del servidor y, al juntar 5 USDC, se manda
todo a Bridge. Convierte también el margen, que no hace falta convertir.

**B.** Al depositar, el escrow presta el USDC en un money market. En cada
cobro, cierre o reembolso retira lo que hace falta. Rinde el pozo más grande,
que son los depósitos de todos los viajes activos. A cambio, el reembolso
deja de depender solo del programa: depende de que el money market tenga
liquidez. Queda por decidir de quién es el interés.

**C.** El escrow queda como está. Lo cobrado va a una tesorería en una
multisig con límite de gasto, y ahí rinde. El backend convierte solo el costo
de Citrus.

B y C no se excluyen: la tesorería en Solana sirve en las dos. La decisión de
fondo es si el depósito del viajero se presta o se queda en la bóveda.

### Rendimiento

- **Dónde.** Kamino Lend. Verificado en devnet el 5/10/2026: el programa
  `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` está desplegado y tiene al
  menos tres reservas cuyo token es el USDC de Circle que usa AstroAm
  (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). No se probó un depósito.
  Marginfi no está en devnet.
- **Cuánto.** Último dato encontrado para USDC en Kamino: 3,51% anual
  (13/9/2026). Durante 2026 se movió entre 4% y 9%.
- **Por viaje:** 20 USDC durante 7 días rinden algo más de 1 centavo.
- **En total:** mil viajes activos de 20 USDC son 20.000 USDC rindiendo, unos
  $700 por año.

El saldo en Citrus y el banco no rinden. Es poca plata: $200 al 3,5% son $7
por año. No conviene achicarlo y arriesgar que se apague la auto-recarga.

## 5. Punto de reposición

Para tener en dólares solo lo necesario y el resto rindiendo:

**En la tarjeta = monto de la auto-recarga + (gasto diario × días que tarda
en llegar la plata) + margen**

Ejemplo con números supuestos: Citrus gasta $8 por día, convertir USDC y que
llegue a la tarjeta tarda 2 días, 3 días de margen, y la auto-recarga cobra de
a $100. En la tarjeta tiene que haber $100 + $8 × (2 + 3) = $140.

El backend conoce el gasto diario por lo que fondea, y cada cobro a la tarjeta
por el aviso `balance.auto_refill_succeeded`. No ve el saldo de la tarjeta:
lo estima.

## 6. Primeros meses

Con poco volumen no se justifica automatizar la parte en dólares.

1. Cargar $100 a $200 en Citrus desde el dashboard. Esa carga guarda la
   tarjeta.
2. Auto-recarga prendida con umbral alto (por ejemplo $50) y monto de $100.
   Los tramos bajan el saldo sin dispararla, así que un umbral de $20 queda
   corto.
3. El backend vigila el saldo y avisa (puntos 4 a 6 de la sección 3).
4. Lo cobrado se queda en la tesorería en Solana.
5. Una vez por mes, convertir a mano el USDC equivalente a lo que gastó
   Citrus y pagar la tarjeta. Sin Bridge todavía.

Automatizar con Bridge cuando pasen más de unos $1.000 por mes por Citrus,
que es también donde empiezan sus descuentos por volumen.

## 7. Otros proveedores

AstroAm necesita tres cosas: cobrar por consumo real, medir por viajero y
devolver lo no usado. Revisados el 5/10/2026 con la documentación pública de
cada uno.

| Proveedor | Cómo cobra | Devuelve lo no usado | Costo fijo | Encaja |
|---|---|---|---|---|
| **Citrus** | Saldo por eSIM, por KB | Sí, vuelve al saldo | $1,75 por eSIM | Sí |
| **Telnyx** | Por MB (IoT) | Solo se paga lo usado | $0,70 por eSIM y $2 por mes | Sí, caro |
| **Soracom** | Por MB (IoT), a mes vencido | Solo se paga lo usado | $0,06 por día o $1,80 por mes | Sí, muy caro |
| **esimba.ai** (Keepgo) | Bloques fijos de megas | No; en "Lifetime" quedan en la eSIM | No publicado | A medias |
| **TelecomsXChange** | Paquetes (GB y días) | No | $599,99 por año | No |
| **eSIM Go** | Paquetes | Solo del inventario | Carga mínima de $1.000, según una reseña | No |
| **Airalo Partner** | Paquetes | No encontrado | Ninguno | No |
| **Celitech** | Paquetes por destino y fechas | Sin confirmar | Precios no públicos | No |
| **Gigs** | Planes con suscripción | No aplica | Por suscriptor y por mes | No |

Precio por MB de los que miden por consumo, contra lo que la app le cobra hoy
al viajero:

| Destino | Soracom (USD) | AstroAm al viajero (USDC) |
|---|---|---|
| Brasil | 0,50 | 0,0025 |
| México | 0,20 | 0,0027 |
| Japón | 0,20 | 0,0021 |
| Argentina | 0,12 | 0,0026 |
| Estados Unidos | 0,073 | 0,0013 |
| España | 0,02 | 0,0008 |

Telnyx publica para Estados Unidos entre $0,0125 y $0,078 por MB; no se
encontró su tarifa para Brasil. Citrus anuncia Japón desde $1,38 por GB.

Ninguno acepta USDC para fondear la cuenta ni tiene API para cargar saldo, en
lo que se encontró publicado. eSIM Go tiene auto-recarga configurable por API
y Airalo y Soracom ofrecen pago a mes vencido, pero ninguno de los tres
cobra por consumo a precio de viajero.

**Conclusión:** seguir con Citrus. Si hiciera falta un respaldo, esimba.ai con
su plan sin vencimiento es el que mejor combina con los tramos; habría que
pedirle la lista de precios.

## 8. Decisiones abiertas

1. **Si el depósito del viajero rinde** (opción B) o solo la tesorería (C).
2. **De quién es el interés** si rinde el escrow: del viajero, de AstroAm o
   repartido.
3. **Probar la auto-recarga** con los tramos por debajo del umbral
   (sección 2).
4. **Pedirle a Citrus** una recarga por API o que la auto-recarga cuente los
   fondeos (support@citrusmobile.com).
5. **Con qué se paga la tarjeta** en los primeros meses, y si conviene una
   tarjeta que se fondee directo con USDC.

## Enlaces

- Citrus, referencia completa: https://citrusmobile.com/llms-full.txt
- Citrus, OpenAPI: https://citrusmobile.com/openapi-reseller.yaml
- Citrus, skills para agentes: https://citrusmobile.com/.well-known/agent-skills/index.json
- Kamino Lend, despliegue: https://www.mintlify.com/kamino-finance/klend/operations/deployment
- Rendimiento de USDC en 2026: https://eco.com/support/en/articles/15182156-usdc-yield-in-2026-where-to-earn-interest-on-usdc
- TelecomsXChange, referencia de API: https://www.telecomsxchange.com/downloads/tcxc-api-reference.md
- Telnyx, precios IoT: https://telnyx.com/pricing/iot-data-plans
- Soracom, lista de tarifas (agosto 2026): https://soracom.io/wp-content/uploads/2026/08/fee_schedule.pdf
- esimba.ai, API 1.13: https://cdn.shopify.com/s/files/1/0546/0449/files/API_Documentation_for_eSIMba_1.13.pdf
- eSIM Go: https://docs.esim-go.com/guides/getting_started/
- Airalo Partner: https://blog.partners.airalo.com/blog/what-is-airalo-partner-platform
- Celitech: https://docs.celitech.com/
