# Mercadia

**El agente de compras que vive en la costura entre dos lugares.**
Pides en tu Slack. Él negocia con proveedores reales en su celular. Vuelve con
la mejor oferta y un botón.

## El problema

Comprar insumos en una empresa pequeña es trabajo manual. Alguien le escribe a
cinco proveedores uno por uno, espera, anota precios en una hoja y decide a
ojo. Ninguno tiene API. Ninguno va a instalar un portal de compras.

Y al delegárselo a un agente aparece el problema que Anthropic dejó abierto en
[Project Deal](https://www.anthropic.com/features/project-deal): **dos agentes
que negocian no tienen por qué ser honestos.** Uno puede ofertar plata que no
tiene, cobrar un trato que nunca existió, o aprovechar que el agente del otro
lado es más débil y cobrarle el triple sin que su dueño se entere.

## Qué hace

Un comprador escribe en el Slack de su equipo:

> necesito 200 botellas de agua para el viernes, máximo $1.500

El agente le escribe a cada proveedor **a su propio celular por Telegram**, en
texto libre, como lo haría una persona. El proveedor contesta *"1.200 la
unidad, te la mando el jueves"* sin instalar nada y sin cambiar cómo trabaja.

Eso se vuelve una cotización estructurada. El agente regatea, compara precio
contra plazo, descarta al que no llega a tiempo diciendo por qué, y vuelve al
hilo con la mejor y un botón. Al aprobar cierra con escrow, firma de las dos
partes y el acta anclada en Base Sepolia. Las dos partes se llevan el contrato.

## Por qué no cabe en un chatbox

Un chatbox es una persona y un modelo. Acá una línea en un canal de trabajo
dispara **varias negociaciones simultáneas entre partes que no se tienen
confianza**, y el canal solo ve el resultado.

El valor no está en la conversación contigo: está en estar en dos lugares a la
vez y convertir un canal humano sin API en algo que se comporta como una API.

## El guardián

El modelo negocia. **El modelo nunca decide si se mueve la plata.** Eso lo
decide código determinista: escrow antes de ofertar, identidad definida por el
canal y no por el mensaje, precio comparado contra la mediana de ese producto,
dos firmas EIP-191, idempotencia y expulsión a la segunda violación.

Es la capa que ni A2A ni MCP expresan: describen cómo hablan los agentes, no
qué pasa si uno miente.

## Correrlo

```bash
npm install
cp .env.example .env     # sin una sola llave también funciona
npm run estado           # qué quedó prendido y qué falta
npm run dev              # http://localhost:3000
```

Sin llaves nada se rompe: cada pieza que falta se apaga sola y el mercado sigue
cerrando tratos. `npm test` corre 94 pruebas sin necesitar credenciales.

## Con qué está hecho

**Node 22+** sin framework, con solo dos dependencias: `viem` para las firmas y
Base Sepolia, y `ws` para los websockets. SQLite, el runner de pruebas y el
servidor HTTP son de la biblioteca estándar. **Angular 21** con señales y
Leaflet en el front. **Slack** en Socket Mode, **Telegram** por long polling,
**Exa** para descubrir proveedores, **Ambiguous AI** por MCP como sistema de
registro, y **DeepInfra** con respaldo en **OpenRouter** como cerebro.

Arquitectura hexagonal, y un test lo verifica: `test/hexagon.test.js` falla si
el dominio importa infraestructura. Son 477 líneas de dominio sin una sola
operación de entrada o salida.

---

**[Manual completo](docs/manual.md)** · cómo se corre, de dónde sale cada
llave, la API para agentes y el despliegue.
**[Brief de entrega](docs/brief.html)** · qué corre verificado y qué no existe.

*AI Tinkerers Bogotá · Equipo Gludsito · 12 de septiembre de 2026*
