# AstroAm: qué falta para la entrega y para que nada esté simulado

**Informe para el equipo** · 7 de octubre de 2026 · **Cierre recomendado por Superteam:** domingo 11/10 a las 23:59

---

## 1. Resumen

La devolución de Superteam Argentina del 5 de octubre puso el proyecto en **46 sobre 100**, con objetivo **80**. Desde entonces el equipo cerró casi todo lo técnico. Lo que falta es lo que el jurado ve primero: **los videos, una eSIM real y la parte de negocio**.

| Ya estaba resuelto en main | Lo que hice hoy (rama `feat/submission-gaps`, sin commit) | Lo que solo puede hacer el equipo |
|---|---|---|
| • El cierre del escrow: el medidor firma el vale y el viajero no puede trabarlo.<br>• El timeout paga lo atestado.<br>• Programa redesplegado en devnet, con una corrida real enlazada. | • README en inglés, con roles y modelo de confianza.<br>• Términos en borrador en `/terms`.<br>• "Why Solana" con las comisiones medidas.<br>• Por qué sigue la clave del deployer.<br>• Toda la carpeta `docs/` en inglés.<br>• Go-to-market con los costos reales de Citrus.<br>• La entrevista (una, la tuya) y el guion para las próximas.<br>• Guía para emitir la eSIM real.<br>• Un error que impedía usar el front desplegado. | • Grabar y publicar el pitch y la demo.<br>• Emitir la eSIM real (Joel).<br>• Desplegar la API y el front.<br>• Tres a cinco entrevistas reales.<br>• Contactar un canal.<br>• Registrarse en Colosseum y enviar en Earn.<br>• Escribirle a Citrus. |

> **Verificación de hoy:** pasan los 226 tests de TypeScript y los 22 del programa en Rust, y los dos chequeos de tipos.

---

## 2. Qué está simulado hoy y qué falta para que no lo esté

| Pieza | Cómo está hoy | Qué falta para que sea real |
|---|---|---|
| **Perfil de la eSIM** | Un proveedor de prueba devuelve un QR de ejemplo. No se emite ninguna línea. | Prender Citrus con su clave y además las dos claves de Solana en la misma API. Ver la [sección 3](#3-la-esim-real-lo-que-le-falta-a-joel). |
| **Consumo** | El botón "Use 250 MB" inventa tráfico. | Poner `ENABLE_DEMO_TRAFFIC=false`. El consumo pasa a ser lo que informa Citrus. Hoy dejé el botón oculto en ese caso. |
| **Precios de la app** | Una tabla fija de tarifas de ejemplo. | Leer las tarifas de Citrus por API. No está construido. La tabla coincide con la red más barata de cada país por 1,5. |
| **USDC** | USDC de devnet, que no vale nada. | Mainnet. Queda fuera del hackathon: pide auditoría, multisig y revisión legal. |
| **Video demo del repo** | Grabado con una wallet de mentira. El README ya avisa que es viejo. | Regrabar con Phantom en devnet, o quitarlo. |
| **USDC cobrado a dólares** | No se mueve nada. | Cuenta de Bridge, o conversión manual una vez por mes. |
| **Botón de arrepentimiento** | Guarda el pedido solo en el navegador. | Un contacto real y la revisión de un abogado. |

> **Lo que ya es real y a veces se confunde:** el escrow en devnet con sus transacciones, la firma del medidor verificada on-chain, y la wallet (Phantom o cualquier wallet estándar). El asistente de presupuesto sigue reglas fijas y no llama a ningún modelo; la app ya lo dice.

---

## 3. La eSIM real: lo que le falta a Joel

Tienen la clave de Citrus y saldo, y aun así "falta algo". **Lo que falta son dos claves de Solana en la misma API.**

Con solo la clave de Citrus, la API sí crea una eSIM real y Citrus cobra $1,75. Pero esa eSIM nace con saldo $0, y con saldo $0 no pasa datos.

La API le carga saldo a la eSIM **únicamente si leyó el depósito del escrow por su cuenta**. Para leerlo usa la clave de operador.

Después del primer tramo, los siguientes se cargan a medida que el medidor firma vales. Para firmarlos hace falta la clave del medidor del programa desplegado.

| Variable en `.env` | Para qué |
|---|---|
| `CONNECTIVITY_PROVIDER=citrus` | Elige el proveedor real. |
| `CITRUS_API_KEY` | La clave de reseller. |
| `SOLANA_OPERATOR_KEYPAIR` | Lee el depósito del escrow, que es lo que destraba el fondeo, y envía los cobros y el cierre. |
| `SOLANA_METER_KEYPAIR` | Firma los vales de consumo. |
| `ENABLE_DEMO_TRAFFIC=false` | Saca el botón que inventa tráfico. |

Las dos claves del programa que está en `.env.example` las tiene Ignacio. Si no se las pasa, Joel puede desplegar su propio programa; el README lo explica en *"Test with your own deploy"*.

### Una corrida real, paso por paso

1. **Revisar el saldo de Citrus:** hacen falta $1,75 de la eSIM más $2,50 del primer tramo. Conviene tener $10.
2. **Poner las cinco variables en un `.env` local.** Para una prueba corta, sumar `CLAIM_MIN_USDC=0.5`.
3. **Levantar la API y la app.** El log de la API tiene que decir `fund flow is automatic`.
4. **Crear una misión de 5 USDC y pagar con Phantom en devnet.**
5. **El log tiene que mostrar `esim tranche funded` con 250 centavos.** Si no aparece, la API no leyó el depósito: revisar la clave de operador.
6. **Escanear el QR con un celular.** Citrus cubre Argentina, así que se puede probar desde casa.
7. **Usar datos y esperar.** Citrus informa el consumo cada 10 minutos y pausa el informe unos 15 minutos después de cada carga.
8. **Cuando aparece el consumo, terminar la misión.** El cierre paga lo usado y devuelve el resto.
9. **Anotar el ICCID con los dígitos del medio tapados**, el consumo que informó Citrus y los links del explorer. Enlazarlos en el README y grabar el recorrido.

> Cuesta $1,75 más los datos que se usen. Lo que sobra del tramo vuelve al saldo de Citrus al cerrar.
> 
> **No poner la clave de Citrus en la demo pública.** El USDC de devnet es gratis. Una API pública con la clave de Citrus dejaría que cualquiera deposite USDC gratis y gaste dólares reales del saldo. La demo pública sigue con el perfil de ejemplo, y la eSIM real se muestra con la corrida grabada.
> 
> *Esta guía sale de leer el código. El camino con Citrus real nunca corrió desde este repo; los tests usan el proveedor de prueba. En el repo quedó en inglés como `docs/real-esim.md`.*

---

## 4. La devolución, punto por punto

| # | Qué pide | Estado | Qué falta |
|---|---|:---:|---|
| 1 | **P0 · Videos públicos** | Falta | Subir pitch y demo a YouTube o Loom, probar en incógnito y poner los links en el README y los formularios. |
| 2 | **P0 · Rotular lo simulado en la demo** | Parcial | El guion de grabación y la app ya están corregidos. El mp4 del repo es el viejo: regrabarlo o quitarlo. |
| 3 | **P0 · Pitch de 2:00 en inglés** | Falta | Grabarlo. El guion está en el [Anexo A](#anexo-a-textos-en-inglés-para-copiar). |
| 4 | **P0 · Todo en inglés** | Hecho en el repo | `README` y `docs/` ya están en inglés. Falta el formulario de la aplicación. Quedan comentarios de código en español, que el jurado no lee. |
| 5 | **P0 · Equipo en Colosseum** | No lo veo | Los cuatro registrados con país Argentina y la URL del proyecto en el README. |
| 6 | **P1 · Corregir el cierre del escrow** | Hecho | Nada. |
| 7 | **P1 · Demo con transacciones visibles** | Parcial | La corrida real está enlazada en el README. Falta el video que abra esas firmas en el explorer. |
| 8 | **P1 · Go-to-market con entrevistas** | Parcial | El plan está escrito. Hay una entrevista, la tuya. Faltan tres a cinco con otros viajeros y contactar un canal. |
| 9 | **P1 · Ángulo argentino con números** | Parcial | Está nuestro precio real (2,48 USDC por giga en Brasil). Falta cotizar lo mismo con tarjeta argentina. |
| 10 | **P1 · Front desplegado** | Parcial | La configuración está lista y arreglé el error que lo rompía. Falta desplegar con las cuentas del equipo. |
| 11 | **P1 · Rol de cada integrante** | Casi | Agregar la experiencia previa de cada uno y llevarlo a la aplicación y al pitch. |
| 12 | **P1 · Reventa de eSIM y términos** | Parcial | Términos en borrador. Falta la respuesta escrita de Citrus (mail en el [Anexo B](#anexo-b-mail-para-citrus)) y la consulta legal. |
| 13 | **P2 · eSIM real con Citrus** | Falta | Sección 3. Responsable: Joel. |
| 14 | **P2 · Solana Pay y wallets móviles** | Falta | Sin empezar. Es para después del hackathon. |
| 15 | **Modelo de confianza del medidor** | Hecho | Nada. |
| 16 | **Por qué Solana es necesaria** | Hecho hoy | Nada. [Sección 5](#5-por-qué-solana). |
| 17 | **Autoridad de upgrade a multisig** | Parcial | Explicado el porqué. Falta hacerlo. [Sección 6](#6-por-qué-sigue-siendo-la-clave-del-deployer). |
| 18 | **Próximo hito con responsable y fecha** | Parcial | El responsable es Joel. Falta ponerle fecha. |
| 19 | **Precio, margen y números** | Hecho hoy | Queda una decisión: cobrar o no un cargo de activación. [Sección 7](#7-go-to-market). |
| 20 | **Logo y envío en Superteam Earn** | No lo veo | Son del formulario. |

> Las dos mejoras de nota más grandes que marca la devolución siguen abiertas: **la eSIM real (fila 13)** y el **front desplegado (fila 10)**.

---

## 5. Por qué Solana

La devolución dice que Solana aparece como *"un rail intercambiable"*. Reescribí la sección del README con cuatro razones concretas y los números medidos en la corrida real del 7/10:

1. **La cadena verifica el vale en la misma transacción que paga.** El programa lee la firma del medidor con el verificador de firmas nativo de Solana. No hay oráculo ni intermediario.
2. **Una bóveda del programa con el USDC de Circle.** Pagarle a AstroAm y devolverle al viajero son dos transferencias dentro del mismo cierre: pasan las dos o ninguna.
3. **Comisiones mucho más chicas que lo que se vende.** Se cobra por tramos de pocos dólares, así que cada viaje son varias transacciones.
4. **El reembolso llega mientras el viajero mira la pantalla.** Las siete transacciones fueron del depósito al cierre en 77 segundos, hechas a mano.

| Transacción | Comisión (lamports) | Cómputo usado |
|---|:---:|:---:|
| Depósito | 5.000 | 19.977 |
| Checkpoint, tres veces | 10.000 cada uno | 4.733 a 4.734 |
| Claim, dos veces | 10.000 cada uno | 13.508 y 22.587 |
| Cierre | 10.000 | 18.128 |
| **Total del viaje** | **65.000 = 0,000065 SOL** | |

Eso es **menos de un centavo de dólar** con SOL por debajo de $150. Responde la pregunta del jurado técnico: *"¿cuánto cuesta en comisiones una sesión completa?"*.

> **Un costo que no está resuelto:** El depósito también le saca al viajero **0,0028 SOL** para crear las cuentas del escrow, y el programa no se los devuelve al cerrar. Es más que todas las comisiones juntas. Lo dejé dicho en el README y en el roadmap: devolverlo en el cierre es un cambio del programa.

---

## 6. Por qué sigue siendo la clave del deployer

Hoy una sola clave puede actualizar el programa y recibe el USDC cobrado. Es la de Ignacio. No es una decisión de diseño; son tres motivos prácticos:

* El programa se redesplegó el 7/10 para guardar la clave del medidor. Un despliegue lo firma una sola clave, y el equipo todavía no creó la multisig.
* El cobrador queda fijo al inicializar. No hay instrucción para cambiarlo. Pasarlo a una multisig obliga a desplegar de nuevo, no alcanza con una transacción.
* El barrido de tesorería lo firma el cobrador. Una multisig no puede firmar desde un servidor; el barrido tendría que pasar a ser una propuesta que aprueban los firmantes.

| Qué puede hacer esa clave | Qué no puede |
|---|---|
| Actualizar el programa. Recibir el USDC que liberan los vales. | Sacar USDC de la bóveda de un viajero. El programa solo paga lo que dice un vale del medidor. |

El riesgo real es la actualización: un programa nuevo podría cambiar esa regla. Por eso lo primero es mover la autoridad de upgrade.

### Qué hacer, en orden

1. Crear una multisig 2 de 3 en Squads, en devnet.
2. Pasarle la autoridad de upgrade. Es una transacción; el comando está en el README.
3. En el próximo despliegue, inicializar con la multisig como cobrador.
4. Hacer backup de `id.json` y `meter.json` fuera de la máquina de Ignacio. Si se pierden, no se puede actualizar el programa ni firmar vales.

Para el jurado alcanza con el **paso 2 hecho y enlazado**. Responde la pregunta de custodia de la sección legal de la devolución.

---

## 7. Go-to-market

Quedó escrito en inglés en `docs/go-to-market.md`. Es un plan con costos publicados; no se contactó ningún canal ni se vendió nada.

### Quién compra
El viajero argentino que ya ahorra en USDC y viaja al exterior. El que usa y el que paga son la misma persona.

### Precio y margen
La regla del código es un solo número: el viajero paga lo que Citrus le cobró a AstroAm, por 1,5 (`MARKUP_BPS=15000`). Los costos son las tarifas publicadas por Citrus para la red más barata de cada país, leídas hoy:

| Destino | Costo por giga (USD) | Paga el viajero (USDC) | Margen por giga |
|---|:---:|:---:|:---:|
| España | 0,54 | 0,81 | 0,27 |
| Estados Unidos | 0,87 | 1,31 | 0,44 |
| Japón | 1,38 | 2,07 | 0,69 |
| Brasil, Chile, Uruguay | 1,65 | 2,48 | 0,83 |
| Argentina | 1,70 | 2,55 | 0,85 |
| México | 1,80 | 2,70 | 0,90 |
| Bolivia | 1,84 | 2,76 | 0,92 |
| Paraguay | 3,50 | 5,25 | 1,75 |

La tarifa depende de la red a la que se conecte el celular. En Brasil, Vivo cuesta $1,65 por giga, Claro $4,14 y TIM $4,84.

### El costo fijo que hay que decidir
Citrus cobra **$1,75 por cada eSIM emitida**, una sola vez; la misma eSIM sirve para los viajes siguientes. En el primer viaje de cada viajero hay que recuperar ese cargo:

| Destino | Margen por giga | Datos para cubrir $1,75 |
|---|:---:|:---:|
| Brasil | 0,83 | 2,1 GB |
| Estados Unidos | 0,44 | 4,0 GB |
| España | 0,27 | 6,5 GB |

Un primer viaje corto pierde plata a este precio. Hay dos salidas: **cobrar un cargo de activación de 1,75 USDC en el primer depósito**, o aceptar la pérdida como costo de conseguir al viajero. No está decidido.

### Canales, en orden
1. **Comunidades cripto donde ya tienen llegada:** `jujuy.dev` y Superteam Argentina. Ya tienen USDC y wallet. Pedido concreto: diez viajeros con un viaje en los próximos 60 días.
2. **Una wallet o exchange argentina** (Lemon, Belo, Ripio). Propuesta: una comisión por viajero que activa.
3. **Una agencia de viajes de Jujuy o el NOA.**
4. **Un hostel u hotel**, que llega a extranjeros que necesitan datos en Argentina.

> Los canales 3 y 4 llegan a gente que en general no tiene USDC. Necesitan lo que todavía no existe: conseguir wallet y USDC sin ayuda.

### Lo que no sabemos
* Qué parte de un depósito termina devuelta. En la corrida de devnet fue 25%, pero es una prueba, no un viajero.
* Cuánto cuesta conseguir un viajero.
* Cuánto cuesta lo mismo pagado con tarjeta argentina. Es la comparación que pide la devolución y hay que cotizarla con fuente y fecha.

---

## 8. Validación: la entrevista

No inventé entrevistas. La devolución ya marcó como falta grave presentar algo simulado como real, y recomienda decir "todavía no validamos demanda" si no hay entrevistas. Lo que hay es **una entrevista real, la que te hice hoy**, anotada como lo que es: el fundador contando su propio viaje.

| Pregunta | Tu respuesta |
|---|---|
| ¿A dónde fue tu último viaje al exterior? | Un país limítrofe. |
| ¿Cómo conseguiste datos móviles? | Roaming de mi operadora. |
| ¿Cuánto pagaste en total? | Entre US$15 y US$30. |
| ¿Cómo lo pagaste? | Con tarjeta argentina. |
| ¿Cuánto de lo que pagaste usaste? | Más o menos la mitad. |
| ¿Qué te molestó más? | Los recargos de la tarjeta, perder lo no usado y que fue complicado de activar. |
| ¿Tenés stablecoins y las usarías para esto? | Sí, y sí. |

> **Lo que sugiere, para comprobar con otra gente:** pagaste por el doble de datos de los que usaste, y el recargo de la tarjeta se siente como un costo aparte.

### Guion para las próximas (diez minutos cada una)

1. ¿A dónde fue tu último viaje al exterior y cuánto duró?
2. ¿Cómo conseguiste datos ahí? ¿Por qué de esa forma?
3. ¿Cuánto pagaste y cómo? ¿La tarjeta sumó algo?
4. ¿Usaste todo lo que pagaste? ¿Qué pasó con el resto?
5. ¿Tenés USDC u otra stablecoin? ¿Dónde? ¿Alguna vez pagaste algo con eso?

*Al final, mostrar la app un minuto y preguntar una sola cosa: **¿qué te frenaría de usar esto en tu próximo viaje?** Anotar fecha, perfil y una frase textual de cada uno en `docs/validation.md`.*

---

## 9. Plan hasta el domingo

Es una propuesta. Solo están confirmados Joel para la eSIM real e Ignacio como quien tiene las claves; el resto hay que asignarlo.

| Cuándo | Qué | Quién |
|---|---|---|
| **Jueves 8** | Pasarle las claves a Joel, o desplegar la API con las claves cargadas. | Ignacio |
| **Jueves 8** | Corrida real con Citrus (sección 3) y anotar el resultado. | Joel |
| **Jueves 8** | Mail a Citrus ([Anexo B](#anexo-b-mail-para-citrus)). | A asignar |
| **Viernes 9** | Desplegar API y front, y que alguien de afuera lo pruebe solo. | A asignar |
| **Viernes 9** | Tres a cinco entrevistas y un mensaje a un canal. | A asignar |
| **Viernes 9** | Cotizar la misma eSIM con tarjeta argentina. | A asignar |
| **Sábado 10** | Grabar la demo con Phantom real y las firmas en el explorer (máximo 3:00). | A asignar |
| **Sábado 10** | Grabar el pitch (máximo 2:00) con el guion del [Anexo A](#anexo-a-textos-en-inglés-para-copiar). | Franco (propuesto) |
| **Domingo 11** | Publicar los videos, actualizar links, revisar Colosseum y Earn. | Todos |
| **Después** | Multisig, devolver la renta del escrow, tarifas reales en la app. | Ignacio y Franco (propuesto) |

---

## 10. Lo que cambió hoy en el repo

Está todo en la rama local `feat/submission-gaps`, sin commit ni push.

* **README:** "Why Solana" nuevo con la tabla de comisiones, el párrafo de la clave del deployer, responsables en el roadmap y links a los documentos de negocio.
* **Documentos nuevos en inglés:** `docs/real-esim.md`, `docs/go-to-market.md` y `docs/validation.md`.
* **Traducidos al inglés:** los cuatro documentos que estaban en español. En la decisión de Citrus y Bridge agregué una nota: la auto-recarga de Citrus solo se dispara al crear una eSIM, no al fondearla.
* **Arreglo en la API:** con el front en otro dominio (Vercel contra Render) la app mostraba `"SERVER OFFLINE"`. Lo confirmé en un navegador antes y después del arreglo.
* **App:** el botón "Use 250 MB" se oculta cuando el tráfico de prueba está apagado.
* **En tu máquina:** actualicé `.env` para que apunte al programa nuevo (el anterior quedó en `.env.old`) y levanté de nuevo los servidores en `localhost:5173`.

---

## Anexo A. Textos en inglés para copiar

### Frase de apertura
> *"Travel data you pay in USDC: you deposit once, AstroAm charges only the megabytes you used, and the rest returns to your wallet by itself."*

### Go-to-market, para la aplicación
> *"We start with Argentine travelers who already hold USDC, reached through the crypto communities where the team is active (jujuy.dev and Superteam Argentina), then Argentine wallets and exchanges on a referral fee. The traveler pays the carrier's cost times 1.5: 2.48 USDC per GB in Brazil at Citrus Mobile's published reseller rate. We have one interview so far, with our founder, and no paying user; demand is not validated yet. The next experiment is ten sessions with real travelers on a real trip."*

### Qué es real y qué no, para poner junto al video
> *"Real: the escrow program on Solana devnet and every transaction shown. Sample: the eSIM profile, which no carrier issued."*  
> *(Si la corrida de Joel sale bien, la segunda oración cambia por: "The eSIM in this run was issued by Citrus Mobile from the app.")*

### Guion del pitch de 2:00
*Son unas 270 palabras. Lo que está entre corchetes lo tienen que completar con un dato real; si no lo tienen, se dice que todavía no lo saben.*

| Tiempo | Sección | Texto |
|---|---|---|
| **0:00–0:15** | **Problem** | An Argentine traveler buys mobile data with a card, pays the surcharges, and loses whatever he did not use. On my last trip I paid between fifteen and thirty dollars for roaming and used about half. |
| **0:15–0:30** | **Insight** | Pay-as-you-go eSIMs keep your credit inside their app. eSIMs paid with crypto sell closed packages with no refund. Nobody returns the unused part to your own wallet. |
| **0:30–1:00** | **Product** | AstroAm: you deposit USDC once into an escrow on Solana. Usage is measured off-chain and our meter signs a running total. One close pays what you used and returns the rest, and the traveler cannot block it. On devnet: 2.5 USDC in, 1.875 paid, 0.625 back, in seven transactions that cost 0.000065 SOL in fees. [The eSIM in this demo is a sample profile / We issued a real eSIM from the app.] |
| **1:00–1:20** | **Evidence** | The program is live on devnet with 22 tests, including the case where the traveler never signs. Every transaction is on the explorer. We have not validated demand yet: we have [N] interviews, and that is our next experiment. |
| **1:20–1:40** | **Segment and price** | We start with Argentine travelers who already hold USDC, through the crypto communities we belong to. We charge the carrier's cost times one and a half: 2.48 USDC per gigabyte in Brazil, against [Y] with an Argentine card. |
| **1:40–1:50** | **Team** | We are four, from Jujuy. Franco builds the escrow and the payments, Ignacio the connectivity and the contracts, Daniel the backend and metering, Joel the app. |
| **1:50–2:00** | **Next** | Next: a real eSIM issued from the flow and ten sessions with travelers on a real trip, led by Joel, by [date]. |

---

## Anexo B. Mail para Citrus

**Para:** `support@citrusmobile.com`  
*Cubre lo que pide la devolución sobre la figura de reventa y lo que nos falta para automatizar la recarga.*

```text
Subject: Reseller questions: resale terms and account auto-refill

Hi,

We are AstroAm, a small team in Argentina building a travel-data product on your Reseller API. Each traveler gets a standalone eSIM, and we fund it in small amounts as they use data. We have three questions.

1. Resale. When we provide a Citrus eSIM to an end user under our own brand, who is the service provider towards that user: Citrus Mobile or us? Is there a reseller agreement or terms that state what we may and may not do?

2. Auto-refill. Our only spend is provisioning; everything else is POST /esim/{iccid}/fund , which your docs describe as a transfer that does not trigger auto-refill. That means our account balance can run down without a charge. Can auto-refill count funding an eSIM, or can the balance be topped up through the API? If the balance is already below the threshold because of transfers, does the next provisioning trigger the charge?

3. Testing. Is there a sandbox, or is production with real money the only way to test?

Thank you,
[name], AstroAm
```
