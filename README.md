# Mercadia — el agente que vive en la costura entre dos lugares

Un comprador pide en el **Slack de su equipo**: "necesito 200 botellas de agua
para el viernes, máximo $1.500". El agente le escribe a cada proveedor **a su
propio celular por Telegram**, en texto libre, como le escribiría un comprador
humano. El proveedor contesta "1.200 la unidad, te la mando el jueves" sin
instalar nada y sin cambiar cómo trabaja.

El agente convierte esa respuesta desordenada en una cotización estructurada,
regatea una ronda, compara precio contra plazo, y vuelve al canal con la mejor
y un botón. Al aprobar, cierra con escrow, firma de las dos partes y el acta
anclada en Base Sepolia. Las dos partes se llevan el contrato.

**Eso es lo que no cabe en un chatbox.** El valor no está en la conversación
con el usuario: está en estar en dos lugares a la vez, mediando entre personas
que no se hablaron, que no cambian nada de cómo trabajan, y convirtiendo un
canal humano sin API en algo que se comporta como una API. Varias veces, en
paralelo, contra contrapartes que no se tienen confianza.

Un **guardián determinista** hace imposible robar y detecta cuando un agente
fuerte está esquilmando a uno débil, el problema abierto que Anthropic
documentó en [Project Deal](https://www.anthropic.com/features/project-deal).

**Brief de entrega**: `docs/brief.html` — qué hace, qué corre verificado, qué no
existe y cómo se demuestra. Publicado en
[claude.ai/code/artifact/5e740620](https://claude.ai/code/artifact/5e740620-2cdd-46e7-81db-fdcf756f57bb).

## Qué se construyó hoy y qué venía de antes

Regla del evento: la funcionalidad central se construye durante el hackathon.
Esto es lo que hay, dicho sin rodeos.

**De antes (hackathon de agosto, 783 líneas):** el libro contable, el núcleo
del guardián (escrow, identidad, strikes), la arena de ladrones y los cerebros
deterministas de la arena.

**De hoy (AI Tinkerers Bogotá, 12 de septiembre):** todo lo que hace que el
agente viva en canales y compre de verdad. Reestructura hexagonal con test que
la sostiene · acta firmada EIP-191 y cadena de hashes · persistencia SQLite ·
idempotencia y registro antes del pago · depósitos, retiros y custodia
declarada · motor de cotizaciones en paralelo (RFQ) · catálogo, geolocalización
y descubrimiento con Exa · autorización con timeout por correo y por Slack ·
contrato HTML · adaptador de Slack (socket mode) · adaptador de Telegram y
proveedor humano · cerebros con modelo (OpenAI → OpenRouter → determinista) ·
tarjeta A2A · front Angular · Docker y stack · 85 pruebas.

Más del ochenta por ciento del código es de hoy, y lo que sobrevive de agosto
quedó reescrito al moverlo al hexágono. El motor previo se declara como
librería base; el proyecto es la mediación multicanal.

## Poner a andar

```bash
npm install
cp .env.example .env     # todas las llaves en un solo lado, con instrucciones dentro
npm run estado           # qué quedó prendido y qué falta
npm run wallets          # una vez, si no existe wallets.json
npm run dev              # backend en :3000
```

El front va en otra terminal:

```bash
npm --prefix web install --legacy-peer-deps
npm run web              # :4200, con proxy a :3000
```

La bandera no es opcional: npm 10.9 se cae resolviendo el grafo de peers de
Angular 21 con `Cannot read properties of null (reading 'edgesOut')`. Es un
bug de npm, no del proyecto, y todas las versiones declaradas existen.

Todo junto en un contenedor, con el mismo `.env`:

```bash
docker compose up --build      # → http://localhost:3000
```

`npm test` corre las 85 pruebas sin necesitar ninguna llave.

### Probar la idea en cinco minutos, con un solo token

Para probar que el motor funciona no hace falta nada: `npm run dev`, abre `/`,
busca *botellas de agua* y llena el formulario. Vas a ver las cotizaciones
llegar, los descartes con su razón, el ganador y el contrato firmado.

Para probar **la idea** — un canal humano sin API comportándose como una API —
alcanza con el token de Telegram y tu propio celular. No hace falta Slack,
porque la página es la otra puerta.

1. Hablale a `@BotFather`, `/newbot`, y pon el token en `.env`.
2. Reinicia. Debe decir `telegram: escuchando como @tu_bot`.
3. Desde tu celular, escríbele a tu bot:
   ```
   /vendo tornillos en Bogotá
   ```
   Usa un producto que nadie más venda para ser el único proveedor y que la
   prueba quede limpia.
4. En `/`, busca *tornillos* y abre la compra.
5. **Tu celular suena.** Contesta como le contestarías a un cliente:
   ```
   te los dejo en 1.200 cada uno y te los mando en 2 días
   ```

El agente lo convierte en cotización, adjudica, firma por las dos partes y te
sirve el contrato. El lector de respuestas funciona sin llave de modelo: tiene
sus propias pruebas y entiende «1.200», «$950 c/u», «mañana» y «el jueves».

### Qué necesitas según lo que quieras mostrar

| camino | llaves | qué se ve |
| --- | --- | --- |
| **Demo completa** | modelo + Slack + Telegram | pides en Slack, tres celulares suenan, apruebas con un botón |
| Compra desde la web | ninguna | el flujo completo de cotización, adjudicación y contrato |
| Proveedores reales de la web | `EXA_API_KEY` | empresas que existen y precio de referencia con fuentes |
| Registro en el workspace | `AMBIGUOUS_API_KEY` | cotizaciones, CRM, contrato a firma y correo |

Sin llaves nada se rompe: cada pieza que falta se apaga sola y el mercado
sigue cerrando tratos. `npm run estado` te lo dice antes de arrancar.

> **Antes de cualquier demo con Telegram:** cada proveedor tiene que mandarle
> `/start` al bot. Un bot no puede escribir primero, así que sin ese paso no le
> llega el mensaje a nadie.

## Dónde vive el agente

| lugar | quién está ahí | qué hace |
| --- | --- | --- |
| Slack | el comprador y su equipo | pide en lenguaje natural, aprueba con un botón |
| Telegram | cada proveedor, en su celular | contesta precio y plazo en texto libre |
| Web | quien quiera mirar | geovisor y la negociación en vivo |
| A2A | otros agentes | `/.well-known/agent-card.json` para descubrir y conectarse |

El puerto `approve` del dominio es el mismo en los tres canales. Empezó siendo
un correo, después un botón de Slack. El dominio nunca se enteró del cambio.

## Las dos puertas (y quién es el dueño de la instancia)

Una compra se abre de dos formas distintas, y de ahí en adelante el recorrido
es idéntico porque las dos llaman a la misma función:

```
  PUERTA A · Slack                    PUERTA B · la página
  el comprador escribe                el comprador llena el formulario
  en el canal de su equipo            en  /  (busca, ve el mapa, pide)
          │                                   │
          │  mensaje → extraer pedido         │  POST /api/buy
          └───────────────┬───────────────────┘
                          ▼
                  comprar()  ← el mismo motor
          cotizar en paralelo · descartar · adjudicar
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
  botón en el hilo   enlace por correo   proveedor en su celular
   (puerta A)         (puerta B)          (Telegram, las dos)
                          │
                          ▼
              contrato firmado a las dos partes
```

La página no es un paso del flujo: es la otra puerta. Sirve para tres cosas
distintas y conviene no confundirlas.

1. **Puerta sin Slack.** El formulario abre la compra igual. Es el camino
   verificado de punta a punta, y el que funciona sin un solo token.
2. **Pantalla grande.** El geovisor y la negociación en vivo, para proyectar
   mientras el hilo de Slack y los celulares se mueven. Es un visor, no un
   control.
3. **Instrumentos de demostración.** `/arena` para ver al guardián expulsar a
   un ladrón, `/atacar` para que el público suelte uno desde el celular.

### Cómo lo obtiene una empresa

Hoy Mercadia es **una instancia por empresa**. No hay cuentas, ni login, ni
aislamiento entre organizaciones: un servidor, un archivo SQLite, una app de
Slack, un bot de Telegram y un catálogo. Quien lo quiera, lo despliega:

```
1. clona el repo y llena su .env
2. crea su app de Slack (socket mode) y su bot de Telegram
3. ./deploy/cloudrun.sh   →  su propia instancia
4. sus proveedores le mandan /start al bot
```

Eso es honesto y es como arranca casi toda herramienta de compras B2B. Lo que
falta para que sea un producto que se reparte es el flujo de instalación:
**OAuth de Slack** (el botón «Añadir a Slack» que guarda un token por
`team_id`), una columna de inquilino en cada tabla, y la decisión de qué se
comparte. Lo interesante de este producto es que el catálogo **debería** ser
compartido entre inquilinos, porque eso es lo que lo vuelve un mercado, mientras
que las compras y el historial de precios de cada canal quedan aislados.

## Cómo se compra

```
pides en Slack "200 botellas de agua para el viernes, máximo $1.500"
   └─► proveedores del catálogo + los que Exa encuentra en la web
        └─► a las personas se les escribe al celular; a los agentes por su API
             └─► cotización EN PARALELO, una ronda de regateo
             └─► descarta al que no llega en plazo o se pasa del techo
                  └─► adjudica al más barato que cumple (empate → el más rápido)
                       └─► ¿autorización por correo? espera el clic
                            └─► escrow · guardián · dos firmas · liquidación
                                 └─► ancla el hash y manda el contrato a las dos partes
```

Dos fases y no una, por una razón concreta: **cotizar no compromete fondos,
cerrar sí**. Si el agente ofertara en paralelo a cinco proveedores
comprometería cinco veces su plata y el guardián lo expulsaría por ofertar sin
fondos. Así que primero pregunta (`quote`) y solo con el ganador oferta
(`offer` + escrow).

## Arquitectura

Hexagonal, y algo lo verifica: `test/hexagon.test.js` falla si el dominio
importa infraestructura.

```
src/market/      el hexágono. Cero I/O. Solo node: y sus propios archivos.
                 rfq · negotiation · guardian · ledger · term-sheet
src/adapters/    todo lo que toca el mundo: sqlite, base sepolia, firma,
                 correo, contrato, websocket, cerebros, archivos estáticos
src/main.js      composition root: el único archivo que conoce a los dos lados
web/             Angular standalone (señales, sin NgRx, sin módulos) + Leaflet
```

Los puertos son los parámetros del constructor (`approve`, `notary`, `record`,
`onEvent`). Primero `record`, después mover la plata: la constancia va antes
que el dinero. No hay interfaces vacías: en JavaScript un puerto es la forma
del argumento, y una interfaz con una sola implementación es código que no
hace nada.

## Seguridad (el guardián)

El LLM nunca es la frontera de seguridad. Todo es determinista:

1. **Escrow**: nadie oferta sin comprometer fondos; solo el mercado liquida.
2. **Mandato vs. acción**: cada acción estructurada se valida contra el ledger.
3. **Identidad no falsificable**: el canal define quién eres, no tu mensaje.
4. **Protección al débil**: el precio se compara contra la mediana **de ese
   producto**; el que se desvía >15% se suspende y el dueño es notificado.
5. **Strikes y expulsión**: dos violaciones y afuera, todo en el log.
6. **Acta firmada**: las dos partes firman el term sheet (EIP-191). Sin las dos
   firmas válidas no se mueve un peso.
7. **Cadena de hashes**: cada mensaje encadena el hash del anterior. Editar o
   borrar uno rompe la cadena. Solo la cabeza se ancla: un tx por negociación.
8. **Idempotencia**: el trato es la clave primaria. Un reintento no paga dos veces.
9. **Walk away**: un agente se levanta de la mesa y se lleva su plata. Irse no
   es una violación.
10. **Explicabilidad**: cada mensaje lleva el `reason` de por qué ofertó,
    aceptó o descartó. Queda en el acta y se ve en pantalla.
11. **Saldo probado, no declarado**: tu saldo es el USDC que depositaste en el
    escrow, leído de la cadena. Sin depósito puedes vender, no comprar.
12. **Una pregunta por trato**: al dueño se le escribe una vez por trato, no
    una vez por ronda. Si dijo que no, no se le vuelve a escribir por lo mismo.

## La plata

```
depósito USDC → escrow ──► saldo en el libro ──► tratos (neteo interno)
                                  │
                                  └──► retiro USDC a tu dirección
```

La cadena se toca cuando entra plata y cuando sale. Un trato mueve saldo dentro
del libro del escrow, no una transferencia por operación: eso quita el gas por
trato y el modo de falla de pagar algo que no se puede pagar. La prueba pública
de cada negociación sigue siendo el hash anclado.

Los depósitos se leen de los logs `Transfer` hacia el escrow, de a una ventana
de bloques por escaneo, y se acreditan por `(tx, log)`: reescanear no acredita
dos veces. Un depósito anterior al registro se acredita cuando el agente prueba
su dirección.

## Custodia de llaves (dilo en voz alta)

Hay tres formas de firmar un acta y el contrato dice cuál se usó:

- **llave propia** — el agente probó su dirección firmando un reto y firma él.
  Nunca vemos su llave. Es la única con autocustodia real.
- **llave de la casa** — los agentes de utilería del coliseo.
- **llave en custodia del mercado** — el que compra desde la web no tiene
  wallet, así que el mercado le guarda una. Es custodia, con todo lo que eso
  implica, y la llave está **en claro en SQLite**: sirve para testnet, no para
  plata de verdad. Ahí va cifrado en reposo o un KMS.

Los agentes de la casa y los compradores sin depósito operan con saldo emitido
por el mercado. La pantalla y el contrato los marcan como demostración.

## Proveedores humanos (Telegram)

Una persona se vuelve proveedor en veinte segundos, desde el celular:

```
/vendo botellas de agua en Bogotá
```

Queda en el catálogo y en el mapa. Cuando alguien pida eso, le llega un mensaje
preguntando precio y plazo. Contesta como le contestaría a cualquier cliente:
el agente lee "te la dejo en 1.200 y te la mando el jueves" y lo convierte en
una cotización con precio y plazo. Si le pagan lo que cotizó, el trato se cierra
sin volver a molestarlo. Si le ofrecen menos, se le pregunta y él decide.

Sin llave de modelo esto también funciona: hay un lector determinista de
respuestas con sus propios tests.

## Ambiguous AI como sistema de registro

Ambiguous no reemplaza a Slack: la persona sigue pidiendo donde ya trabaja.
Lo que hace es que cada compra deje huella en el espacio de trabajo del
agente, por MCP (`https://app.ambiguous.ai/mcp`, Bearer):

| momento | namespace | qué queda |
| --- | --- | --- |
| cada cotización y cada descarte | `sheets.*` | una fila en el libro de cotizaciones, con la razón |
| adjudicación | `crm.*` | el proveedor con lo que se le pagó |
| contrato | `sign.*` | el documento a firma de las dos partes |
| contrato | `mail.*` | el correo con la copia |

Los nombres exactos de las herramientas los publica el servidor; el adaptador
los busca por patrón y apaga el espejo que no encuentre. Nada de esto está en
el camino crítico: si Ambiguous falla, la compra cierra igual.

```bash
npx ambiguous auth signup --name "Mercadia" --human-email tu@correo.com
AMBIGUOUS_API_KEY=… npm run ambiguous:tools     # la "llamada tonta": lista y espejos resueltos
```

**El proveedor no va en Ambiguous.** Sigue en Telegram, en su celular. Si las
dos partes quedaran dentro del mismo workspace, la costura desaparece.

## Interoperabilidad (A2A)

`GET /.well-known/agent-card.json` publica la Agent Card del mercado, con sus
dos habilidades (`sell`, `buy`) y el transporte.

La tarjeta trae además un bloque `x-mercadia/guarantees`, que es una extensión
nuestra a propósito: **A2A y MCP describen cómo hablan los agentes, no qué pasa
si uno miente.** Eso no lo expresa ningún protocolo hoy, y es exactamente lo que
hace el guardián: escrow antes de ofertar, identidad por canal, banda de precio
justo, dos firmas, idempotencia y expulsión.

## API para agentes externos

```js
const ws = new WebSocket('ws://HOST:3000/ws');
ws.send(JSON.stringify({
  type: 'join', name: 'MI-AGENTE', owner: 'Mi Empresa', role: 'seller',
  qty: 1000, address: '0xTuDireccion',
}));

// El join dispara un reto de identidad. Fírmalo o entras sin saldo:
// reto:   { type: 'sign_request', name, message: 'mercadia/auth/1|…' }
// →       { type: 'signature', name, signature }   // EIP-191

// publica qué vendes y dónde estás (así entras al catálogo y al mapa):
ws.send(JSON.stringify({ type: 'listing', item: 'botellas de agua',
  leadDays: 2, minPrice: 40, lat: 4.71, lon: -74.07, city: 'Bogotá', country: 'CO' }));

// turno:  { type: 'your_turn', name, view: { round, item, bestOffer, lastQuote } }
// →       { type: 'action', name, text, reason, action: {…} }
// acciones: quote {price,qty,leadDays} | offer | accept {offerId} | talk | reject | walk_away

// retiro: { type: 'withdraw', amount: 3000 }   // fuera de sesión, a tu dirección
```

Si no respondes en 10 s, pasas el turno. Dos violaciones y quedas expulsado.

## HTTP

```
GET  /api/catalog                  quién vende qué y dónde (el mapa)
GET  /api/search?item=agua         proveedores de un producto
POST /api/listings                 publicar oferta (seller, item, leadDays, minPrice, lat, lon, city)
POST /api/buy                      abrir compra (item, qty, maxPrice, maxLeadDays, owner, email, authorize)
GET  /api/contract/:id             el contrato firmado
GET  /api/decision/:id/:si|no/:t   el enlace del correo de autorización
GET  /api/reputation               tratos y faltas por agente
GET  /api/health                   salud para el orquestador (toca la base)
```

## Estado y persistencia

SQLite (`node:sqlite`, stdlib, cero dependencias) en `DB_PATH`: catálogo,
ubicaciones, tratos, contratos, eventos, reputación, direcciones probadas,
depósitos acreditados, saldos y llaves en custodia. La historia de precios
sobrevive al reinicio: sin ella el detector de explotación se queda ciego.

## Serverless (Cloud Run)

Sí, con una precisión: **serverless de contenedor, no de funciones.**

Mercadia mantiene dos conexiones largas abiertas (el socket de Slack y el long
polling de Telegram), espera minutos a que una persona conteste, y tiene un
solo escritor de SQLite. Eso no cabe en una función por request. Sí cabe en
Cloud Run, que es la misma imagen del compose:

```bash
PROYECTO=tu-proyecto ./deploy/cloudrun.sh
```

Tres banderas no son opcionales y están explicadas en el script:
`--min-instances 1` para que el proceso exista aunque nadie entre,
`--max-instances 1` por el escritor único y el estado en memoria, y
`--no-cpu-throttling` porque sin eso Cloud Run estrangula la CPU entre
requests y el trabajo de fondo se muere.

El script es idempotente: habilita las APIs, sube a Secret Manager cada llave
de tu `.env` que tenga valor, construye la imagen (con el build de Angular
dentro) y fija `PUBLIC_URL` en una segunda pasada, porque la URL no se conoce
hasta después del primer despliegue.

`/api/health` ya existe para las sondas. Los secretos entran desde Secret
Manager como variables; si prefieres montarlos como archivo, cualquier
variable acepta `VAR_FILE` apuntando a la ruta montada.

La base en `/tmp` es efímera. No rompe la demo, porque el catálogo se siembra
al arrancar, pero el historial de precios del canal empieza de cero en cada
reinicio. Para que persista: un bucket con Cloud Storage FUSE, o mover el
store a Postgres.

### Si de verdad quieres funciones

Hay que cambiar tres cosas, y ninguna es trivial:

| pieza | hoy | en funciones |
| --- | --- | --- |
| Slack | socket mode, sin URL pública | Events API por HTTP + verificar la firma |
| Telegram | long polling | `setWebhook` a un endpoint público |
| la aprobación | una promesa que se espera | estado durable: suspender y reanudar en el click |
| la compra | minutos en un proceso | un motor de workflows durables (Trigger.dev) |
| SQLite | archivo con un escritor | Postgres o Turso |

El puerto `approve` del dominio aguanta el cambio sin tocarse, que es el punto
del hexágono. Lo que hay que reescribir son los adaptadores y el arranque.

## Variables de entorno

Todas viven en `.env`, y `.env.example` trae cada una comentada con dónde
sacarla y qué se apaga si falta. Los scripts la cargan solos
(`--env-file-if-exists`), así que no hay que exportar nada a mano.

| bloque | variables | si falta |
| --- | --- | --- |
| cerebro | `OPENAI_API_KEY` · `OPENROUTER_API_KEY` | negocia determinista |
| canales | `SLACK_APP_TOKEN` · `SLACK_BOT_TOKEN` · `TELEGRAM_BOT_TOKEN` | ese canal se apaga |
| descubrimiento | `EXA_API_KEY` · `MARKET_PLACE` | solo el catálogo sembrado |
| registro | `AMBIGUOUS_API_KEY` · `AMBIGUOUS_MCP_URL` | no queda huella en el workspace |
| correo | `MAIL_API_KEY` · `MAIL_FROM` | el enlace sale en pantalla |
| cadena | `BASE_SEPOLIA_RPC` · `DEPOSITS_FROM_BLOCK` · `WALLETS_FILE` | el hash existe, sin anclar |
| servidor | `PORT` · `PUBLIC_URL` · `APPROVAL_SECRET` · `APPROVAL_TTL_MS` · `DB_PATH` | usa los valores por defecto |
| operación | `CONTROL_TOKEN` | **los controles quedan abiertos**: cualquiera aprueba |

En swarm los secretos entran como archivo: cualquiera de arriba acepta
`VAR_FILE` apuntando a `/run/secrets/…`.
