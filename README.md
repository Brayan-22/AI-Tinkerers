# Mercadia — el agente que vive en la costura entre dos lugares

Un comprador pide en el **Slack de su equipo**: "necesito 200 botellas de agua
para el viernes, máximo $1.500". El agente le escribe a cada proveedor **a su
propio celular por Telegram**, en texto libre, como le escribiría un comprador
humano. El proveedor contesta "1.200 la unidad, te la mando el jueves" sin
instalar nada y sin saber que del otro lado hay un agente.

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

## Correr

```bash
npm install
npm run wallets              # llaves del escrow y de los agentes de la casa (una vez)
npm run dev                  # backend en :3000
npm --prefix web install     # una vez
npm run web                  # front de Angular en :4200, con proxy a :3000
npm test
```

## Docker

Una máquina, un comando:

```bash
docker compose up --build            # → http://localhost:3000
```

Con `docker stack` (swarm). `stack deploy` no construye imágenes ni lee `.env`,
así que la imagen y los secretos se preparan antes:

```bash
docker swarm init                                      # una vez
npm run wallets                                        # si no tienes wallets.json
npm run image                                          # docker build -t mercadia:latest .
openssl rand -hex 32 | docker secret create mercadia_approval -
docker secret create mercadia_wallets ./wallets.json
npm run stack:up                                       # docker stack deploy -c stack.yml mercadia
npm run stack:logs                                     # docker service logs -f mercadia_app
npm run stack:down
```

Las llaves y el secreto de las autorizaciones entran como **secretos de swarm**,
montados en `/run/secrets`, no como variables de entorno: una variable se ve en
`docker inspect`, un archivo montado no. El código acepta las dos formas
(`VAR` o `VAR_FILE`).

**Una sola réplica, a propósito.** El estado vive en un archivo SQLite y en la
memoria del proceso: la arena, los turnos de los agentes, las autorizaciones
abiertas esperando un clic. Con dos réplicas habría dos escritores del mismo
archivo y la mitad de los websockets hablando con el proceso equivocado. Para
escalar en horizontal hay que sacar ese estado afuera primero, y eso es otro
trabajo, no una bandera en el `stack.yml`.

Con varios nodos hay que publicar la imagen en un registro: el nodo que levante
el servicio tiene que poder bajarla.

El contenedor no corre como root y trae healthcheck contra `/api/health`, que
toca la base de verdad en vez de responder 200 a ciegas.

- **`/`** — el mercado: buscas, ves proveedores en el mapa, abres la compra y
  miras a tu agente negociar en vivo.
- **`/arena`** — el coliseo del guardián: ladrones contra el mercado.
- **`/atacar`** — desde el celular, suelta tu agente ladrón.

## Dónde vive el agente

| lugar | quién está ahí | qué hace |
| --- | --- | --- |
| Slack | el comprador y su equipo | pide en lenguaje natural, aprueba con un botón |
| Telegram | cada proveedor, en su celular | contesta precio y plazo en texto libre |
| Web | quien quiera mirar | geovisor y la negociación en vivo |
| A2A | otros agentes | `/.well-known/agent-card.json` para descubrir y conectarse |

El puerto `approve` del dominio es el mismo en los tres canales. Empezó siendo
un correo, después un botón de Slack. El dominio nunca se enteró del cambio.

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

## Variables de entorno

```
BASE_SEPOLIA_RPC=    # opcional, default sepolia.base.org
DEPOSITS_FROM_BLOCK= # opcional, bloque inicial para traer depósitos viejos
DB_PATH=             # opcional, default ./data/mercadia.db
PORT=                # opcional, default 3000
PUBLIC_URL=          # opcional, base de los enlaces del correo
MAIL_API_KEY=        # opcional (Resend). Sin esto el enlace sale en pantalla
MAIL_FROM=           # remitente del correo
APPROVAL_SECRET=     # firma de los enlaces de autorización
WALLETS_FILE=        # opcional, ruta de wallets.json (en swarm, /run/secrets/wallets)
APPROVAL_TTL_MS=     # opcional, default 10 minutos; vencido = no
                     # los secretos aceptan VAR o VAR_FILE (Docker Swarm)
OPENROUTER_API_KEY=  # o OPENAI_API_KEY: cerebros LLM. Sin llave, deterministas
LLM_MODEL=           # opcional, default openai/gpt-4o-mini
LLM_BASE_URL=        # opcional, cualquier API compatible con OpenAI
EXA_API_KEY=         # descubrimiento de proveedores y referencia de precio
SLACK_APP_TOKEN=     # xapp-… socket mode
SLACK_BOT_TOKEN=     # xoxb-… chat:write, app_mentions:read, im:history, users:read
TELEGRAM_BOT_TOKEN=  # el bot que habla con los proveedores (BotFather)
MARKET_PLACE=        # opcional, dónde buscar proveedores. Default Colombia
```
