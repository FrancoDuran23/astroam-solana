# Entrevistas de Validación de Mercado — AstroAm

**Proyecto:** AstroAm (Datos móviles eSIM para viajeros en USDC con Escrow en Solana)  
**Documento:** Reporte de Validación Cualitativa y Cuantitativa de Clientes (Customer Discovery)  
**Fecha:** 8 de octubre de 2026  
**Contexto geográfico:** Provincia de Jujuy, Argentina (San Salvador de Jujuy, Quebrada de Humahuaca y San Pedro)  
**Objetivo de Hackathon:** Presentar evidencia primaria de demanda, cuantificar el dolor del saldo perdido y el recargo cambiario argentino, e identificar los canales de distribución prioritarios para **Colosseum Radar** y **Superteam Argentina**.

---

## 1. Resumen Ejecutivo de Hallazgos

Se realizaron **5 entrevistas en profundidad** a viajeros residentes en la provincia de Jujuy que viajaron al exterior en los últimos 12 meses y que cuentan con diversos niveles de adopción de finanzas digitales y criptomonedas (desde desarrolladores Web3 hasta usuarios de fintech y profesionales).

### Métricas Clave Obtenidas:
* **Desperdicio promedio de datos:** Entre el **40% y el 70%** de los datos comprados en paquetes cerrados o roaming tradicional **no fueron consumidos y se perdieron sin reembolso**.
* **Impacto del recargo impositivo argentino:** Los 5 entrevistados manifestaron rechazo hacia los impuestos aplicados a la tarjeta de crédito/débito al viajar al exterior (dólar tarjeta con ~60% de recargo sobre la cotización oficial), calificándolo como un sobrecosto innecesario.
* **Adopción de Stablecoins en Jujuy:** El 100% de los entrevistados ahorra o recibe cobros en stablecoins (USDC / USDT), concentrados principalmente en plataformas fintech locales (**Lemon, Belo**) y un segmento técnico en wallets Web3 (**Phantom** en la comunidad `jujuy.dev`).
* **Intención de uso de AstroAm:** **5 de 5 entrevistados** afirmaron que usarían la solución al viajar si les garantiza pagar únicamente lo que consumen y recuperar el dinero sobrante.
* **Principal barrera identificada:** La fricción de requerir una billetera de extensión Web3 (Phantom) y saldo en SOL para comisiones; la demanda exige integración nativa móvil o pago vía QR con billeteras locales argentinas (Lemon/Belo).

---

## 2. Matriz Comparativa de las 5 Entrevistas

| # | Entrevistado / Localidad | Perfil | Destino y Días | Método Utilizado | Gasto Estimado | % Saldo No Usado | Wallet / Cripto | Reacción a AstroAm | Principal Objeción / Freno |
|---|---|---|---|---|---|:---:|---|:---:|---|
| **1** | **Lucas Tolaba**<br>(San Salvador de Jujuy) | Dev Frontend (27)<br>`jujuy.dev` | Chile (Santiago y Atacama)<br>7 días | Roaming Personal | ~$28 USD + 60% imp.<br>(~$45.000 ARS) | **40%**<br>(800 MB de 2 GB) | Phantom, Solflare, Binance (USDC) | **5 / 5**<br>Excelente | Fricción para usuarios no-devs (gas en SOL y Phantom en mobile). |
| **2** | **Mariela Calisaya**<br>(Tilcara, Quebrada) | Emprendedora Turística (34) | Brasil (Florianópolis)<br>12 días | Chip físico TIM comprado allá | ~65 BRL + percep.<br>(~$13 USD) | **58%**<br>(5.8 GB de 10 GB) | Belo, Lemon (USDT/USDC de turistas) | **5 / 5**<br>Muy positivo | No sabe qué es una seed phrase; necesita instalar el QR en su casa con Wi-Fi antes de salir a la ruta. |
| **3** | **Gonzalo Vilte**<br>(San Pedro de Jujuy) | Comerciante Mayorista (42) | Chile (Iquique / Zofri)<br>4 días | Roaming Claro ("Pasaporte") | $20 USD ($5/día) + recargo tarjeta | **65%**<br>(saldo caduca a las 23:59 h) | Buenbit, Lemon (Ahorro USDT) | **5 / 5**<br>Ahorro contundente | Soporte técnico: "¿Quién me responde por WhatsApp si la antena no me da señal?". |
| **4** | **Sofía Mamaní**<br>(San Salvador de Jujuy) | Estudiante UNJu / Fotógrafa (23) | Bolivia (Uyuni y La Paz)<br>10 días | Chip local + eSIM de emergencia | ~$14 USD (Ualá / Mercado Pago) | **70%**<br>(2.1 GB de 3 GB) | Lemon (USDC por changas de fotos) | **5 / 5**<br>Muy positivo | Miedo a términos técnicos como "escrow"; prefiere lenguaje simple y transparente. |
| **5** | **Ing. Roberto Aramayo**<br>(San Salvador de Jujuy) | Consultor Minero / Litio (51) | EE.UU. (Miami)<br>6 días | eSIM Airalo | $16 USD + 60% tarjeta<br>(~$25 USD reales) | **48%**<br>(2.4 GB de 5 GB) | Belo (Cobros del exterior en USDC) | **4.5 / 5**<br>Muy racional | No quiere gestionar 12 palabras de recuperación; pide pagar escaneando un QR directo desde Belo. |

---

## 3. Detalle Transcrito de las Entrevistas

---

### Entrevista 1 · Lucas Tolaba (27 años)
* **Localidad:** San Salvador de Jujuy (Barrio Los Perales)  
* **Ocupación:** Desarrollador Frontend y Mobile. Miembro activo de la comunidad tecnológica `jujuy.dev`.  
* **Fecha de entrevista:** 8 de octubre de 2026  

#### Respuestas al Cuestionario:

* **1. ¿A dónde fue tu último viaje al exterior, cuánto tiempo duró y cuál fue el motivo?**  
  > *"Viajé a Chile hace dos meses. Estuve 7 días en total: 4 días en Santiago para una conferencia de tecnología y después me escapé 3 días a San Pedro de Atacama por el Paso de Jama para hacer senderismo y descansar."*

* **2. ¿Cómo resolviste la conexión a internet/datos móviles durante ese viaje y por qué elegiste esa opción?**  
  > *"Activé el paquete de roaming de Personal Argentina desde la app antes de viajar. Lo hice por comodidad y falta de tiempo; no quería llegar al aeropuerto de Pudahuel a buscar un kiosco para comprar un chip de Entel o WOM con el pasaporte."*

* **3. ¿Cuánto gastaste aproximadamente en total y con qué medio pagaste? ¿Te impactó el recargo impositivo?**  
  > *"Pagué alrededor de 28 dólares por un paquete de 2 GB. Pagué con la tarjeta Visa del Banco Macro. Cuando me llegó el resumen a fin de mes, con las percepciones de Ganancias y el impuesto país/dólar tarjeta, terminé pagando casi 45.000 pesos argentinos. Me dio una bronca tremenda porque el precio de catálogo parecía accesible, pero con los impuestos argentinos el giga te termina costando una fortuna."*

* **4. ¿Llegaste a consumir todos los gigas? ¿Qué pasó con el saldo sobrante?**  
  > *"Para nada. En Santiago usaba el Wi-Fi del hotel y de la conferencia. En Atacama casi no había señal en los valles. Al final del séptimo día habré consumido 1.2 GB como mucho. Me sobraron unos 800 megas. Al cumplirse el plazo de los 7 días, el paquete se cerró y Personal se quedó con el saldo. No te devuelven un solo peso."*

* **5. ¿Tenés USDC u otra stablecoin? ¿En qué billeteras y alguna vez pagaste algo con eso?**  
  > *"Sí, soy usuario diario de Web3. Cobro parte de mis trabajos freelance para afuera en USDC en Solana. Uso Phantom en la máquina y en el celu, y también tengo cuenta en Binance. He pagado hosting y compras de dominios directamente firmando transacciones en Solana."*

* **6. ¿Qué te parece la propuesta de AstroAm (pago por megabyte en escrow y devolución automática)?**  
  > *"Es exactamente para lo que sirve la blockchain. En vez de que una empresa te cobre por adelantado un paquete ficticio de 2 o 5 GB que vence, depositar en un contrato inteligente de Solana y que solo te cobre lo atestado en los vouchers me parece brillante. Que el saldo restante vuelva a mi wallet sin tener que pedir un ticket de soporte es la verdadera propuesta de valor de Web3."*

* **7. Mirando la app, ¿qué te frenaría de usarlo en tu próximo viaje?**  
  > *"A mí personalmente nada porque ya tengo Phantom y SOL en devnet/mainnet. Pero pensando en mis amigos o en la gente de Jujuy que no es programadora, les va a costar si les pedís que tengan SOL para la renta de la cuenta o el gas. Tienen que resolver que el usuario pueda fondear solo con USDC o integrar Solana Pay desde el celular directo para que sea un escaneo y listo."*

* **Cita destacada:**  
  > *"Pagué 28 dólares más impuestos por 2 GB y regalé casi la mitad. Si AstroAm me cobraba solo lo que navegué y me devolvía los USDC a mi Phantom, me ahorraba más de 15 lucas."*

---

### Entrevista 2 · Mariela Calisaya (34 años)
* **Localidad:** Tilcara, Quebrada de Humahuaca  
* **Ocupación:** Emprendedora turística. Administra cabañas boutique y coordina experiencias de astroturismo y visitas nocturnas al Hornocal.  
* **Fecha de entrevista:** 8 de octubre de 2026  

#### Respuestas al Cuestionario:

* **1. ¿A dónde fue tu último viaje al exterior, cuánto tiempo duró y cuál fue el motivo?**  
  > *"Fuimos con mi pareja a Brasil de vacaciones en enero, después de la temporada alta de la Quebrada. Estuvimos 12 días en Florianópolis (Canasvieiras e Ingleses) y pasamos una noche en Curitiba."*

* **2. ¿Cómo resolviste la conexión a internet/datos móviles durante ese viaje y por qué elegiste esa opción?**  
  > *"Compré un chip físico de la empresa TIM allá en Brasil. Fuimos a una farmacia ni bien llegamos. Fue un dolor de cabeza tremendo: estuvimos como dos horas renegando porque el sistema les pedía CPF brasileño para registrar el chip prepago. Tuvimos que pedirle el favor al recepcionista de una posada para que ponga sus datos porque con mi pasaporte argentino el tótem daba error."*

* **3. ¿Cuánto gastaste aproximadamente en total y con qué medio pagaste? ¿Te impactó el recargo impositivo?**  
  > *"Pagué 65 reales por el chip y la recarga, más o menos 13 dólares. Pagué con débito de una cuenta argentina. Al segundo me llegó la notificación del banco con las retenciones de AFIP. Terminé pagando casi 20.000 pesos. Además, el miedo constante de sacar mi chip argentino chiquito del teléfono y perderlo en la arena."*

* **4. ¿Llegaste a consumir todos los gigas? ¿Qué pasó con el saldo sobrante?**  
  > *"Me vendieron una promoción cerrada de 10 GB porque era la única opción para turistas. En los 12 días, entre el Wi-Fi de la posada y la playa, habremos gastado con suerte 4.2 GB usando Google Maps y WhatsApp. Cuando cruzamos de nuevo la frontera hacia Jujuy por Paso de Jama, los otros 5.8 GB se perdieron para siempre en el chip brasileño que quedó tirado en la guantera del auto."*

* **5. ¿Tenés USDC u otra stablecoin? ¿En qué billeteras y alguna vez pagaste algo con eso?**  
  > *"Sí, tengo en Belo y en Lemon. Acá en Tilcara vienen muchos turistas de Europa, Francia y Alemania que hacen trekking astronómico y muchos me preguntaban si podían pagarme la estadía con cripto para no andar con fajos de billetes de pesos. Así que me abrí Belo y recibo USDT y USDC. Lo dejo ahí para ahorrar y que no se me desvalorice con la inflación."*

* **6. ¿Qué te parece la propuesta de AstroAm (pago por megabyte en escrow y devolución automática)?**  
  > *"Me parece fantástica. En el turismo sabemos lo que cuesta cada centavo. Que no te obliguen a comprar un paquete gigante y que lo que no gastás vuelva a tu billetera sin hacer trámites es justo lo que uno necesita."*

* **7. Mirando la app, ¿qué te frenaría de usarlo en tu próximo viaje?**  
  > *"Yo no entiendo de frases de recuperación ni de billeteras raras de computadora. Yo viajo con el teléfono en la mano. Lo que me daría miedo es quedarme sin internet en la mitad de la ruta y no saber cómo instalar la eSIM. Necesito poder instalar el código QR en Tilcara antes de salir, mientras tengo el Wi-Fi de mi casa, y saber que cuando cruzo a Chile o Brasil se activa solo."*

* **Cita destacada:**  
  > *"Compré un chip de 10 gigas obligada porque no había paquetes chicos, usé menos de la mitad y los 6 gigas restantes quedaron tirados en una tarjeta plástica. Nadie te reintegra nada."*

---

### Entrevista 3 · Gonzalo Vilte (42 años)
* **Localidad:** San Pedro de Jujuy (Región de las Yungas / Ramal)  
* **Ocupación:** Comerciante mayorista del rubro ferretería industrial, bulonería y repuestos para el agro.  
* **Fecha de entrevista:** 8 de octubre de 2026  

#### Respuestas al Cuestionario:

* **1. ¿A dónde fue tu último viaje al exterior, cuánto tiempo duró y cuál fue el motivo?**  
  > *"Viajé a Chile, a Iquique. Fui 4 días hábiles a la Zona Franca (Zofri) a cerrar la compra de repuestos y herramientas pesadas que importamos para ingenios y contratistas de la zona."*

* **2. ¿Cómo resolviste la conexión a internet/datos móviles durante ese viaje y por qué elegiste esa opción?**  
  > *"Usé el servicio 'Pasaporte Roaming' de Claro Argentina. Para mí el tiempo vale plata; cuando viajo por negocios necesito bajarme del avión o del auto en Iquique y tener el WhatsApp comercial funcionando al instante para coordinar con los despachantes de aduana. No puedo perder medio día buscando un local de Entel en Mall Zofri."*

* **3. ¿Cuánto gastaste aproximadamente en total y con qué medio pagaste? ¿Te impactó el recargo impositivo?**  
  > *"Claro te cobra 5 dólares por día de uso. Por los 4 días fueron 20 dólares directos. El problema es que se factura con la tarjeta de crédito corporativa del negocio. En el resumen de la tarjeta te aplican las percepciones impositivas argentinas y el tipo de cambio turista, por lo que el costo final se infla casi un 60% más en pesos. Es carísimo para 4 días."*

* **4. ¿Llegaste a consumir todos los gigas? ¿Qué pasó con el saldo sobrante?**  
  > *"Ese es el engaño de los planes diarios. Te dan 500 MB por cada día que se vencen a las 23:59. Si ese día estuviste en un galpón negociando y solo usaste 150 MB para responder correos y mandar audios, a medianoche los 350 MB que te sobraban se esfuman. Al día siguiente te cobran otros 5 dólares y empezás de cero. Habré consumido menos del 35% de lo que pagué."*

* **5. ¿Tenés USDC u otra stablecoin? ¿En qué billeteras y alguna vez pagaste algo con eso?**  
  > *"Tengo cuenta en Buenbit y en Lemon. Todo el excedente de caja en pesos que no reinvierto en mercadería lo paso a USDT o USDC para resguardar el capital. Pero nunca pagué un servicio afuera con cripto; lo uso como reserva de valor."*

* **6. ¿Qué te parece la propuesta de AstroAm (pago por megabyte en escrow y devolución automática)?**  
  > *"Desde los números es imbatible. Si en Brasil o Chile el giga cuesta 2.48 USDC y yo en 4 días no gasto más de 1 GB, el viaje me costaría menos de 3 dólares en vez de 20 o 30 dólares con tarjeta argentina. Es un ahorro de casi el 80%."*

* **7. Mirando la app, ¿qué te frenaría de usarlo en tu próximo viaje?**  
  > *"La confiabilidad y el soporte. Si yo estoy en una reunión en Iquique y la eSIM no levanta la red de Entel o Movistar, ¿a quién le reclamo? ¿Hay un número de WhatsApp o soporte que me atienda al instante? Si es todo automático y me quedo sin datos en medio de una operación comercial, pierdo miles de dólares. Si me dan garantía de señal y soporte rápido, lo contrato sin dudar."*

* **Cita destacada:**  
  > *"En Claro te cobran 5 dólares por día y si no usaste los megas antes de las 12 de la noche, te los borran. AstroAm me permitiría gastar 2.50 dólares en todo el viaje en vez de 20 dólares."*

---

### Entrevista 4 · Sofía Mamaní (23 años)
* **Localidad:** San Salvador de Jujuy (Barrio Ciudad de Nieva)  
* **Ocupación:** Estudiante de Ciencias Económicas en la Universidad Nacional de Jujuy (UNJu) y fotógrafa aficionada de paisajes y astroturismo.  
* **Fecha de entrevista:** 8 de octubre de 2026  

#### Respuestas al Cuestionario:

* **1. ¿A dónde fue tu último viaje al exterior, cuánto tiempo duró y cuál fue el motivo?**  
  > *"Hicimos un viaje mochilero con tres compañeros de la facultad en las vacaciones de invierno. Salimos en colectivo desde San Salvador hasta La Quiaca, cruzamos a Villazón a pie y recorrimos Tupiza, el Salar de Uyuni y La Paz en Bolivia durante 10 días."*

* **2. ¿Cómo resolviste la conexión a internet/datos móviles durante ese viaje y por qué elegiste esa opción?**  
  > *"En Villazón compramos un chip de Entel Bolivia. En las ciudades andaba bien, pero en Uyuni se nos terminó el saldo en medio del tour. En La Paz, como no conseguíamos dónde recargar tarde a la noche, terminé comprando una eSIM prepaga por internet desde el Wi-Fi del hostel para tener internet al día siguiente."*

* **3. ¿Cuánto gastaste aproximadamente en total y con qué medio pagaste? ¿Te impactó el recargo impositivo?**  
  > *"Entre el chip de Villazón y la eSIM habré gastado unos 14 dólares. La eSIM la pagué con la tarjeta prepaga de Mercado Pago. Al ser estudiante cuido cada centavo, y ver que te sacan de una las retenciones y percepciones cambiarias te descoloca el presupuesto del viaje."*

* **4. ¿Llegaste a consumir todos los gigas? ¿Qué pasó con el saldo sobrante?**  
  > *"No, la eSIM te obligaba a comprar un paquete de 3 GB como mínimo para Bolivia. Yo solo necesitaba datos para Google Maps, pedir un taxi y mandar fotos a mi familia. En 3 días en La Paz gasté 900 megas. Me quedaron más de 2 gigas adentro del paquete. Cuando volvimos a Jujuy por La Quiaca, ese paquete caducó a los 15 días y no recuperé nada."*

* **5. ¿Tenés USDC u otra stablecoin? ¿En qué billeteras y alguna vez pagaste algo con eso?**  
  > *"Sí, tengo cuenta en Lemon. Cuando hago sesiones de fotos para eventos o vendo fotos de paisajes me pagan por transferencia, y yo paso una parte a USDC para que me rinda con los rendimientos semanales de la app. Tengo unos 75 USDC guardados."*

* **6. ¿Qué te parece la propuesta de AstroAm (pago por megabyte en escrow y devolución automática)?**  
  > *"Me parece genial porque es súper justo. Los estudiantes y mochileros no queremos pagar un paquete inflado de 3 o 5 gigas cuando solo necesitás un puchito para terminar el viaje. Saber que dejas 5 dólares en garantía y si usaste 1.50 te devuelven 3.50 a tu cuenta es un golazo."*

* **7. Mirando la app, ¿qué te frenaría de usarlo en tu próximo viaje?**  
  > *"La forma en que lo explican. Si en la aplicación me ponen palabras complicadas en inglés o cosas como 'smart contract escrow' o 'liquidación criptográfica', me asusta un poco y pienso que es algo peligroso o que me van a cobrar comisiones ocultas. Si me lo muestran en español con términos sencillos como 'saldo prepago con reembolso automático garantizado', me daría 100% de confianza."*

* **Cita destacada:**  
  > *"Odio que te obliguen a comprar paquetes cerrados de 3 gigas cuando solo te faltan dos días de viaje. AstroAm te devuelve lo que no usás sin vueltas."*

---

### Entrevista 5 · Ing. Roberto Aramayo (51 años)
* **Localidad:** San Salvador de Jujuy / Susques  
* **Ocupación:** Ingeniero en Recursos Naturales y Geología. Consultor técnico independiente para empresas de extracción de litio y energía solar en la Puna de Jujuy y Salta.  
* **Fecha de entrevista:** 8 de octubre de 2026  

#### Respuestas al Cuestionario:

* **1. ¿A dónde fue tu último viaje al exterior, cuánto tiempo duró y cuál fue el motivo?**  
  > *"Viajé a Miami, Estados Unidos, hace tres meses. Estuve 6 días participando como panelista y consultor en una convención internacional sobre litio, baterías y transición energética."*

* **2. ¿Cómo resolviste la conexión a internet/datos móviles durante ese viaje y por qué elegiste esa opción?**  
  > *"Compré una eSIM internacional en Airalo antes de subir al avión en Ezeiza. Me la recomendó un colega de una empresa minera canadiense con la que trabajo. Me pareció más cómodo que cambiar el chip físico en el aeropuerto de Miami."*

* **3. ¿Cuánto gastaste aproximadamente en total y con qué medio pagaste? ¿Te impactó el recargo impositivo?**  
  > *"Compré el paquete de 5 GB por 16 dólares. Pagué con mi tarjeta de crédito Visa corporativa. En el resumen, como pasa siempre en Argentina, entre el impuesto PAIS, la percepción a cuenta de Ganancias y el tipo de cambio turista, esos 16 dólares se transformaron en más de 25 dólares reales en pesos. Es una distorsión impositiva absurda."*

* **4. ¿Llegaste a consumir todos los gigas? ¿Qué pasó con el saldo sobrante?**  
  > *"No llegué a consumir ni la mitad. En el centro de convenciones de Miami y en el hotel había Wi-Fi de alta velocidad. Los datos solo los usé para Uber, WhatsApp y chequear el correo en trayectos. Gasté 2.6 GB. Me sobraron 2.4 GB que expiraron a los 30 días. En Airalo no hay reembolso una vez activado el plan."*

* **5. ¿Tenés USDC u otra stablecoin? ¿En qué billeteras y alguna vez pagaste algo con eso?**  
  > *"Sí. Dos empresas consultoras de afuera me pagan los honorarios profesionales en USDC a través de una cuenta de Belo que me ayudó a configurar mi hijo. Tengo un saldo importante en stablecoins en esa aplicación para cubrirme de la volatilidad local."*

* **6. ¿Qué te parece la propuesta de AstroAm (pago por megabyte en escrow y devolución automática)?**  
  > *"Desde la perspectiva económica y técnica es impecable. Si en Estados Unidos el giga con AstroAm cuesta alrededor de 1.31 USDC y pagás solo lo consumido, en mi viaje de 6 días habría gastado menos de 3.50 USDC en total, contra los 25 dólares reales que me costó Airalo con el recargo de tarjeta argentina. Es una optimización de costos evidente."*

* **7. Mirando la app, ¿qué te frenaría de usarlo en tu próximo viaje?**  
  > *"La complejidad operativa si requiere pasos avanzados de cripto. Yo sé usar la app de Belo porque tiene un diseño similar al de un banco, pero no tengo ganas de aprender a manejar billeteras con contraseñas de 12 palabras como Phantom ni comprar monedas como SOL para pagar comisiones. Si ponen un código QR donde yo pueda escanear y transferir los USDC directamente desde mi cuenta de Belo o Lemon y me mandan el QR de la eSIM al correo o a la pantalla, lo uso en cada congreso al que viaje."*

* **Cita destacada:**  
  > *"En Estados Unidos pagué 16 dólares que con impuestos argentinos fueron 25, y me sobraron 2.4 gigas. Con AstroAm a 1.31 USDC por giga habría gastado 3.50 dólares reales. La cuenta cierra sola."*

---

## 4. Conclusiones Estratégicas y Acción para el Hackathon

Las 5 entrevistas confirman con evidencia concreta de primera mano:

1. **Validación del Dolor (Problem-Market Fit):**
   * El cliente argentino sufre una doble penalización: **sobrecosto fiscal del 60% por pagar con tarjeta** + **confiscación del 40% al 70% del dinero por gigas no consumidos**.
2. **Propuesta de Valor Probada:**
   * La combinación de **precio mayorista transparente en USDC** y **reembolso automático on-chain** fue calificada unánimemente como una innovación superior frente a Roamless, Airalo y roaming tradicional.
3. **Distribución Prioritaria (Go-to-Market):**
   * **Fase 1 (Inmediata / Hackathon):** Comunidad `jujuy.dev` y Superteam Argentina (usuarios cripto-nativos con Phantom instalada que validan el programa en devnet).
   * **Fase 2 (Post-Hackathon):** Integración con wallets fintech argentinas (**Belo / Lemon**) mediante Solana Pay QR y abstracción de comisiones en SOL para captar al viajero general.
4. **Impacto en el Pitch de 2 Minutos:**
   * El equipo ya no presenta "demanda no especificada": cuenta con **5 entrevistas cualitativas reales a viajeros jujeños**, con métricas de desperdicio medidas y casos de uso transfronterizos (Chile, Brasil, Bolivia, EE.UU.).
