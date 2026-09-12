// Arranque de Mercadia. Acá — y solo acá — el dominio se conecta con el mundo:
// disco, red, blockchain, correo, websockets. El hexágono no sabe que existe.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Negotiation } from './market/negotiation.js';
import { Rfq } from './market/rfq.js';
import { openStore } from './adapters/store.sqlite.js';
import { walletNotary, signedBy } from './adapters/signer.wallet.js';
import { remoteAgents } from './adapters/brain.remote.js';
import { serveWeb } from './adapters/web.static.js';
import { emailApprovals, mailer } from './adapters/approve.email.js';
import { secret, env } from './adapters/secrets.js';
import { controlGate } from './adapters/control.js';
import { renderContract } from './adapters/contract.html.js';
import { mockBrain, supplierBrain, askBrain } from './adapters/brain.mock.js';
import { llmBrain, llmKey, proveedores } from './adapters/brain.llm.js';
import { descubrir, exaKey, cityOf } from './adapters/discovery.exa.js';
import { telegramChannel } from './adapters/channel.telegram.js';
import { ambiguousChannel } from './adapters/channel.ambiguous.js';
import { humanBrain } from './adapters/brain.human.js';
import { extraerPedido } from './adapters/brain.llm.js';
import { slackChannel } from './adapters/channel.slack.js';
import { STRATEGIES, makeAttacker } from './adapters/brain.attackers.js';
import { incomingTransfers, withdraw, anchor } from './adapters/chain.base-sepolia.js';

const PORT = env('PORT', 3000);
const WEB = env('WEB_DIR', new URL('../web/dist/web/browser', import.meta.url).pathname);
const BASE = env('PUBLIC_URL', `http://localhost:${PORT}`);
const PRESUPUESTO_DEMO = 50000; // al que no depositó, el mercado le presta para probar

const store = openStore();
const remote = remoteAgents();
const notary = walletNotary(remote, store);
const mail = mailer();
const labels = new Map(); // metadatos de pantalla de los atacantes
const attackerQueue = [];
const joinQueue = [];
const busy = new Set(); // agentes con plata comprometida ahora mismo
const mando = controlGate(); // quién puede arrancar la arena y aprobar compras
const TOPE_COLA = 20; // la cola de atacantes no es infinita

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const paced = (brain) => async (agent, view) => { await sleep(900); return brain(agent, view); };
// Con LLM la latencia del modelo ya marca el ritmo; sin LLM se finge para que
// la conversación se pueda leer en pantalla.
const pensando = (brain) => (llmKey() ? llmBrain(brain) : paced(brain));
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '-').toUpperCase().slice(0, 16) || 'ANON';
const entre = (v, min, max, def) => Math.min(max, Math.max(min, Number(v) || def));

// ── Catálogo de arranque ───────────────────────────────────────────────────
// Un mercado vacío no se puede mostrar. Estos proveedores existen para que la
// primera búsqueda devuelva algo; cualquier agente real entra por el API.
const SEMILLA = [
  { name: 'HIDRO-ANDINA', owner: 'Hidro Andina', city: 'Bogotá', country: 'CO', lat: 4.711, lon: -74.072, item: 'botellas de agua', leadDays: 2, minPrice: 40 },
  { name: 'AGUAS-MDE', owner: 'Aguas de Antioquia', city: 'Medellín', country: 'CO', lat: 6.244, lon: -75.581, item: 'botellas de agua', leadDays: 1, minPrice: 47 },
  { name: 'PACIFIC-WATER', owner: 'Pacific Water', city: 'Lima', country: 'PE', lat: -12.046, lon: -77.043, item: 'botellas de agua', leadDays: 6, minPrice: 36 },
  { name: 'AQUA-MX', owner: 'Aqua del Norte', city: 'Ciudad de México', country: 'MX', lat: 19.433, lon: -99.133, item: 'botellas de agua', leadDays: 9, minPrice: 33 },
  { name: 'IBERAGUA', owner: 'Iberagua', city: 'Madrid', country: 'ES', lat: 40.417, lon: -3.704, item: 'botellas de agua', leadDays: 14, minPrice: 30 },
  { name: 'CAFE-QUINDIO', owner: 'Café del Quindío', city: 'Armenia', country: 'CO', lat: 4.533, lon: -75.681, item: 'café', leadDays: 3, minPrice: 820 },
  { name: 'CAFE-SP', owner: 'Café Paulista', city: 'São Paulo', country: 'BR', lat: -23.551, lon: -46.633, item: 'café', leadDays: 8, minPrice: 700 },
  { name: 'CARTON-BOG', owner: 'Cartones del Norte', city: 'Bogotá', country: 'CO', lat: 4.65, lon: -74.1, item: 'cajas de cartón', leadDays: 2, minPrice: 120 },
  { name: 'PACK-MIA', owner: 'Miami Packaging', city: 'Miami', country: 'US', lat: 25.761, lon: -80.191, item: 'cajas de cartón', leadDays: 5, minPrice: 95 },
];

function sembrar() {
  if (store.catalog().length) return;
  for (const s of SEMILLA) {
    store.recordAgent(s.name, s.owner);
    store.placeAgent(s.name, s);
    store.listSupply(s.name, s);
  }
}
sembrar();

// ── HTTP ───────────────────────────────────────────────────────────────────
const web = serveWeb(WEB);
const json = (res, data, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};
const html = (res, body, code = 200) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
};

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 4000) req.destroy(); }); // frontera: nadie manda megas
  req.on('end', () => { try { cb(JSON.parse(body)); } catch { cb(null); } });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  // A2A: cualquier agente puede descubrir el mercado y conectarse a vender.
  if (url.pathname.startsWith('/.well-known/agent')) return json(res, tarjetaA2A());
  web(req, res);
});

function api(req, res, url) {
  const ruta = url.pathname;
  const post = req.method === 'POST';

  // Salud: toca la base de verdad. Un healthcheck que solo responde 200 no
  // sirve para que el orquestador sepa si el servicio está vivo.
  if (ruta === '/api/health') {
    try { return json(res, { ok: true, listings: store.catalog().length, arena: running, llm: Boolean(llmKey()), exa: Boolean(exaKey()) }); }
    catch (e) { return json(res, { ok: false, error: e.message }, 503); }
  }

  if (ruta === '/api/reputation') return json(res, boardRows());
  if (ruta === '/api/catalog') return json(res, store.catalog());
  if (ruta === '/api/search') return json(res, store.search(url.searchParams.get('item')));

  if (ruta === '/api/listings' && post) {
    return readBody(req, (b) => {
      const seller = String(b?.seller ?? '').slice(0, 16).replace(/[^\w-]/g, '');
      const item = String(b?.item ?? '').trim().slice(0, 60);
      if (!seller || !item) return json(res, { error: 'falta seller o item' }, 400);
      publicar(seller, String(b?.owner ?? seller).slice(0, 40), b, item);
      json(res, { ok: true, seller, item });
    });
  }

  if (ruta === '/api/buy' && post) {
    return readBody(req, (b) => {
      const item = String(b?.item ?? '').trim().slice(0, 60);
      if (!item) return json(res, { error: 'falta qué quieres comprar' }, 400);

      const locales = store.search(item);
      if (!locales.length && !exaKey()) return json(res, { error: `nadie vende "${item}" todavía` }, 404);

      const owner = String(b?.owner ?? 'Comprador').slice(0, 40);
      const buyer = `COMPRA-${slug(owner)}`;
      const saldo = store.balance(buyer);
      const demand = {
        buyer, owner, item,
        qty: entre(b?.qty, 1, 100000, 100),
        maxPrice: entre(b?.maxPrice, 1, 1e7, 100),
        maxLeadDays: entre(b?.maxLeadDays, 1, 365, 30),
        budget: saldo ?? PRESUPUESTO_DEMO,
        email: String(b?.email ?? '').slice(0, 120),
        mode: b?.authorize ? 'supervised' : 'auto',
        place: String(b?.place ?? 'Colombia').slice(0, 40),
        brain: pensando(askBrain),
      };
      store.recordAgent(buyer, owner);
      if (Number.isFinite(Number(b?.lat))) store.placeAgent(buyer, { lat: Number(b.lat), lon: Number(b.lon), city: String(b?.city ?? '').slice(0, 40), country: String(b?.country ?? '').slice(0, 2) });

      const id = randomUUID();
      comprar(id, demand, saldo !== null).catch((e) => publish({ type: 'rfq_error', rfq: id, reason: e.message }));
      return json(res, {
        rfq: id, suppliers: locales.length, budget: demand.budget,
        funded: saldo !== null, buscandoEnLaWeb: Boolean(exaKey()),
      });
    });
  }

  if (ruta === '/api/attack' && post) {
    return readBody(req, (b) => {
      const sponsor = String(b?.nombre ?? '').slice(0, 24).trim() || 'anon';
      const strategy = STRATEGIES[b?.estrategia] ? b.estrategia : 'sin-fondos';
      const name = `LADRON-${slug(sponsor)}`;
      // Frontera pública: una persona con un bucle no llena la cola para siempre.
      if (attackerQueue.length >= TOPE_COLA) return json(res, { error: 'la cola está llena, espera un turno' }, 429);
      if (attackerQueue.some((a) => a.name === name)) return json(res, { error: 'ya tienes un ladrón en cola' }, 429);
      labels.set(name, { sponsor, strategy, label: STRATEGIES[strategy].label, queued: true });
      store.recordAgent(name, sponsor);
      attackerQueue.push({ name, sponsor, strategy });
      publish({ type: 'attacker_queued', name, sponsor, label: STRATEGIES[strategy].label });
      json(res, { name, posicion: attackerQueue.length });
    });
  }

  if (ruta.startsWith('/api/decision/')) {
    const [, , , id, answer, token] = ruta.split('/');
    const r = approvals.decide(id, answer, token);
    return html(res, pagina(r.ok
      ? (r.answer === 'si' ? 'Autorizado. Tu agente cierra el trato.' : 'Rechazado. El trato no se cierra.')
      : `No se pudo: ${r.reason}`), r.ok ? 200 : 410);
  }

  if (ruta.startsWith('/api/contract/')) {
    const c = store.contract(ruta.split('/').pop());
    return c ? html(res, c.html) : html(res, pagina('Ese contrato no existe.'), 404);
  }

  json(res, { error: 'no existe' }, 404);
}

// Tarjeta A2A (Agent Card): así se descubre este mercado desde otro agente.
// El bloque de garantías es una extensión nuestra a propósito: A2A describe
// cómo hablan los agentes, no quién responde si uno roba. Eso es el guardián.
const tarjetaA2A = () => ({
  protocolVersion: '0.3.0',
  name: 'Mercadia',
  description: 'Mercado de compraventa entre agentes: cotiza con varios proveedores a la vez, compara precio y plazo, y cierra con escrow, firma de las dos partes y acta anclada en Base Sepolia.',
  url: `${BASE.replace('http', 'ws')}/ws`,
  preferredTransport: 'WEBSOCKET',
  version: '1.0.0',
  provider: { organization: 'Mercadia', url: BASE },
  capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
  defaultInputModes: ['text/plain', 'application/json'],
  defaultOutputModes: ['application/json'],
  skills: [
    {
      id: 'sell', name: 'Vender en el mercado',
      description: 'Conecta tu agente y cotiza cuando alguien pida tu producto. Necesitas una dirección que puedas firmar.',
      tags: ['negotiation', 'quote', 'supply'],
      examples: ['{"type":"join","role":"seller","name":"MI-AGENTE","address":"0x…"}'],
    },
    {
      id: 'buy', name: 'Comprar por cotización',
      description: 'Abre una compra con cantidad, techo de precio y plazo. Devuelve la mejor cotización que cumple, con contrato firmado.',
      tags: ['procurement', 'rfq', 'contract'],
      examples: ['POST /api/buy {"item":"botellas de agua","qty":200,"maxPrice":1500,"maxLeadDays":3}'],
    },
  ],
  'x-mercadia/guarantees': {
    nota: 'Lo que A2A y MCP no pueden expresar: qué pasa si una de las partes miente. Todo esto es determinista y no lo decide ningún modelo.',
    escrowAntesDeOfertar: 'Una oferta sin fondos comprometidos se rechaza.',
    identidadPorCanal: 'Quién eres lo define el socket con el que entraste, no lo que diga tu mensaje.',
    precioJusto: 'Cada trato se compara contra la mediana de ese producto; desviarse más de 15% lo suspende.',
    dosFirmas: 'Sin firma EIP-191 válida de comprador y vendedor no se mueve un peso.',
    idempotencia: 'El trato es clave primaria: un reintento no paga dos veces.',
    expulsion: 'Dos violaciones y el agente sale del mercado, con log de auditoría.',
  },
});

const pagina = (texto) => `<!doctype html><meta charset="utf-8"><title>Mercadia</title>
<body style="font-family:ui-monospace,monospace;background:#0a0e14;color:#e8e4d8;display:grid;place-items:center;height:100vh;margin:0">
<p>${texto}</p></body>`;

function publicar(seller, owner, b, item) {
  store.recordAgent(seller, owner);
  if (Number.isFinite(Number(b?.lat))) {
    store.placeAgent(seller, { lat: Number(b.lat), lon: Number(b.lon), city: String(b?.city ?? '').slice(0, 40), country: String(b?.country ?? '').slice(0, 2) });
  }
  store.listSupply(seller, { item, leadDays: entre(b?.leadDays, 0, 365, 7), minPrice: Math.max(0, Number(b?.minPrice) || 0) });
  publish({ type: 'listing', seller, owner, item });
}

const wss = new WebSocketServer({ server, path: '/ws' });

// Dejar constancia y avisarle a las pantallas son dos trabajos, no uno.
function project(ev) {
  store.appendEvent(sessionNo, ev);
  if (ev.type === 'violation') store.recordViolation(ev.agent);
  if (ev.expelled) store.markExpelled(ev.agent);
}

function broadcast(ev) {
  const raw = JSON.stringify(ev);
  for (const c of wss.clients) if (c.readyState === 1) c.send(raw);
}

const publish = (ev) => { project(ev); broadcast(ev); };

const approvals = emailApprovals({
  secret: secret('APPROVAL_SECRET'), baseUrl: BASE, send: mail, onEvent: publish,
  ttlMs: Number(process.env.APPROVAL_TTL_MS) || 10 * 60 * 1000,
});

const boardRows = () => store.reputation().slice(0, 12).map((r) => ({ ...r, ...(labels.get(r.name) ?? {}) }));
const sendBoard = () => publish({ type: 'leaderboard', board: boardRows() });

// ── La compra: cotizar a varios, adjudicar a uno, firmar y entregar copia ──
async function comprar(id, demand, funded, canal = {}) {
  // 1. Buscar proveedores de verdad en la web y sacar la referencia de precio.
  const referencia = await descubrirProveedores(id, demand, canal.sink);

  // 2. Armar la mesa. El que no tiene piso de precio queda en el mapa pero
  //    fuera de la negociación: no se le inventa una cotización.
  const proveedores = store.search(demand.item).filter((p) => p.minPrice > 0 || p.telegram);
  if (!proveedores.length) {
    publish({ type: 'rfq_empty', rfq: id, item: demand.item, cotizadas: 0, descartadas: [], reason: 'ningún proveedor con precio' });
    return;
  }

  const suppliers = proveedores.map((p) => ({
    name: p.seller, owner: p.owner ?? p.seller, role: 'seller', budget: 0,
    minPrice: p.minPrice ?? 0, leadDays: p.leadDays ?? 7, qty: demand.qty, city: p.city,
    humano: Boolean(p.telegram),
    simulado: !p.telegram && p.source === 'exa' && !remote.has(p.seller),
    // El orden importa: una persona real manda sobre cualquier simulación.
    brain: p.telegram ? humanBrain(telegram, p.telegram, { qty: demand.qty, comprador: demand.owner })
      : remote.has(p.seller) ? remote.brain(p.seller)
        : pensando(supplierBrain),
  }));

  const humanos = suppliers.filter((s) => s.humano);
  if (humanos.length) {
    publish({ type: 'humans_asked', rfq: id, item: demand.item, count: humanos.length, who: humanos.map((h) => h.owner) });
  }

  // 3. Comparables: los tratos cerrados de ese producto manda. Si no hay tres,
  //    entra la referencia de la web para que el guardián no esté ciego.
  // Precedencia de comparables: lo que ESTE canal pagó, después el mercado
  // entero, y de último la referencia de la web. El contexto manda.
  const delCanal = store.channelPrices(demand.channel, demand.item);
  const reales = delCanal.length >= 3 ? delCanal : [...delCanal, ...store.closedPrices(50, demand.item)];
  const history = reales.length >= 3 ? reales : [...reales, ...(referencia?.prices ?? [])];

  const espejoAmbiguous = ambiguous.activo() ? ambiguous.registro(demand) : null;
  // Todo lo de esta compra sale por acá. Antes, lo posterior al trato se
  // difundía solo por websocket y ni el hilo ni el registro lo veían.
  const anunciar = (ev) => { publish(ev); canal.sink?.(ev); espejoAmbiguous?.(ev); };

  const rfq = new Rfq({
    id, demand, suppliers, notary,
    // A una persona no se le manda tres mensajes seguidos.
    rondas: humanos.length ? 2 : 3,
    record: (deal) => store.saveDeal({ ...deal, channel: demand.channel }),
    history,
    approve: canal.approve
      ?? (demand.mode === 'supervised'
        ? (req) => approvals.approve({ ...req, email: demand.email, owner: demand.owner })
        : undefined),
    onEvent: anunciar,
  });

  const { deal, quotes } = await rfq.run();
  if (!deal) return;

  // La plata solo se mueve de verdad si el comprador de verdad depositó.
  if (funded) {
    store.setBalance(demand.buyer, (store.balance(demand.buyer) ?? 0) - deal.total);
    store.setBalance(deal.seller, (store.balance(deal.seller) ?? 0) + deal.total);
  }

  const acta = await anchor(deal.sheet.chainHead).catch((e) => ({ error: e.message }));
  anunciar({ type: 'notarized', rfq: id, ...acta });

  const proveedor = suppliers.find((s) => s.name === deal.seller);
  const documento = renderContract({
    sheet: deal.sheet, anchor: acta, quotes,
    buyerOwner: demand.owner, sellerOwner: proveedor?.owner,
    custody: { [deal.buyer]: notary.custodyOf(deal.buyer), [deal.seller]: notary.custodyOf(deal.seller) },
  });
  store.saveContract(deal.id, documento, deal.sheet);
  const url = `${BASE}/api/contract/${deal.id}`;

  await mail({
    to: demand.email,
    subject: `Contrato cerrado: ${demand.qty} × ${demand.item}`,
    html: `<p>Cerraste con <b>${proveedor?.owner ?? deal.seller}</b> por $${deal.total}.</p>
           <p><a href="${url}">Ver el contrato firmado</a></p>`,
  }).catch(() => ({}));

  anunciar({ type: 'contract', rfq: id, dealId: deal.id, url, buyer: demand.buyer, seller: deal.seller, funded });
}

// Descubrimiento con Exa: proveedores reales al catálogo y al mapa, y una
// referencia de precio citada para el guardián.
async function descubrirProveedores(id, demand, sink) {
  if (!exaKey()) return null;
  const avisar = (ev) => { publish(ev); sink?.(ev); };
  avisar({ type: 'discovering', rfq: id, item: demand.item, place: demand.place });

  const { suppliers, market, error } = await descubrir({ item: demand.item, place: demand.place })
    .catch((e) => ({ suppliers: [], market: null, error: e.message }));
  if (error) avisar({ type: 'discovery_failed', rfq: id, reason: error });

  const nuevos = [];
  for (const s of suppliers) {
    // Sin precio propio, el piso estimado sale de la referencia de mercado, y
    // queda marcado como simulado: es una negociación sobre datos públicos.
    const minPrice = s.minPrice ?? market?.median ?? null;
    store.recordAgent(s.seller, s.owner);
    store.placeAgent(s.seller, s);
    store.listSupply(s.seller, { item: demand.item, leadDays: s.leadDays, minPrice, source: 'exa', url: s.url });
    nuevos.push({ seller: s.seller, owner: s.owner, city: s.city, url: s.url, minPrice, simulado: true });
  }
  if (nuevos.length) avisar({ type: 'discovered', rfq: id, item: demand.item, suppliers: nuevos });
  if (market?.median) avisar({ type: 'market_reference', rfq: id, item: demand.item, median: market.median, sources: market.sources });
  return market;
}

// ── Telegram: el proveedor, en su propio celular ───────────────────────────
const telegram = telegramChannel({ onEvent: publish, onMessage: mensajeDeTelegram });

// ── Ambiguous: el sistema de registro del agente (no la superficie humana) ──
const ambiguous = ambiguousChannel({ onEvent: publish });

const AYUDA = `*Mercadia* · el agente de compras.

Conecto a quien necesita comprar con proveedores como tú. Así funciona:

*1.* Te registras diciendo qué vendes y dónde estás.
*2.* Cuando alguien lo necesite, te escribo por acá y te pregunto precio y plazo.
*3.* Me contestas en texto normal, como a cualquier cliente:
     _"a $1.200 la unidad, entrego en 2 días"_
*4.* Compito tu oferta contra las demás. Si ganas, te llega el contrato.

No tienes que instalar nada ni estar pendiente. Solo contestar cuando escriba.

*Comandos*
/vendo _qué vendes_ — registrarte
/mis — ver lo que tienes publicado
/borrar — dejar de vender
/ayuda — esto`;

// Un proveedor se registra en dos pasos: qué vende y dónde está. Si no dice la
// ciudad, se le pregunta en vez de guardar un registro a medias.
async function mensajeDeTelegram(texto, quien) {
  const t = String(texto).trim();
  const name = `PROV-${slug(quien.name)}`;

  if (/^\/(start|ayuda|help|comenzar)\b/i.test(t)) return telegram.decir(quien.chat, AYUDA);

  if (/^\/mis\b/i.test(t)) {
    const mias = store.listingsOf(name);
    if (!mias.length) return telegram.decir(quien.chat, 'Todavía no vendes nada acá. Empieza con:\n`/vendo computadores`');
    return telegram.decir(quien.chat,
      `Vendes esto${mias[0].city ? ` desde *${mias[0].city}*` : ''}:\n`
      + mias.map((m) => `  · ${m.item}`).join('\n')
      + '\n\nTe escribo cuando alguien lo pida. /borrar para salir del catálogo.');
  }

  if (/^\/borrar\b/i.test(t)) {
    const cuantas = store.dropListings(name);
    return telegram.decir(quien.chat, cuantas
      ? `Listo, saqué ${cuantas === 1 ? 'tu publicación' : `tus ${cuantas} publicaciones`} del catálogo. Vuelve cuando quieras con /vendo.`
      : 'No tenías nada publicado.');
  }

  // /vendo, /vender, /venta o simplemente "vendo …": lo que la gente escribe.
  const m = t.match(/^\/?(?:vendo|vender|venta|ofrezco)\s+(.+?)(?:\s+en\s+([^,.]+))?\s*$/i);
  if (!m) {
    return telegram.decir(quien.chat,
      'No te entendí. Dime qué vendes así:\n`/vendo computadores`\n\n/ayuda si quieres el resumen completo.');
  }

  const item = m[1].trim().slice(0, 60);
  let donde = cityOf(m[2] ?? '') ?? cityOf(t);

  if (!donde) {
    await telegram.decir(quien.chat,
      `Anotado: *${item}*.\n¿En qué ciudad estás? Así solo te llegan pedidos que puedas cumplir a tiempo.`);
    const ciudad = await telegram.esperar(quien.chat, 180_000);
    donde = cityOf(ciudad ?? '');
    if (!donde && ciudad) {
      await telegram.decir(quien.chat, `No tengo *${String(ciudad).slice(0, 40)}* en el mapa, así que te dejo sin ubicación. Igual te llegan los pedidos.`);
    }
  }

  store.recordAgent(name, quien.name);
  store.setTelegram(name, quien.chat);
  if (donde) store.placeAgent(name, donde);
  store.listSupply(name, { item, leadDays: null, minPrice: null, source: 'telegram' });
  publish({ type: 'listing', seller: name, owner: quien.name, item, via: 'telegram', city: donde?.city ?? null });

  return telegram.decir(quien.chat,
    `Listo, *${quien.name}*. Vendes *${item}*${donde ? ` desde *${donde.city}*` : ''}.\n\n`
    + 'Cuando alguien lo necesite te escribo acá preguntando *precio por unidad* y *en cuántos días entregas*. '
    + 'Contestas normal, sin formato: _"a $1.200 cada uno, en 2 días"_.\n\n'
    + 'Si tu oferta gana, te llega el contrato firmado. /mis para ver lo tuyo.');
}

// ── Slack: el agente donde ya se compra ────────────────────────────────────
const slack = slackChannel({ onEvent: publish, onDemand: pedidoDeSlack });

async function pedidoDeSlack(texto, donde) {
  const pedido = await extraerPedido(texto);
  if (!pedido.item) {
    return slack.decir(donde, 'No entendí qué necesitas. Escríbelo así: *necesito 200 botellas de agua para el viernes, máximo $1.500 c/u*');
  }

  const perfil = (await slack.quienEs(donde.user).catch(() => null)) ?? {};
  const quien = perfil.nombre ?? 'Comprador';
  const buyer = `COMPRA-${slug(quien)}`;
  const saldo = store.balance(buyer);

  // Contexto del canal: lo que aquí ya se compró antes.
  const ultima = store.lastDealIn(donde.channel, pedido.item);
  const techo = pedido.maxPrice ?? (ultima ? Math.round(ultima.price * 1.15) : 1e6);

  await slack.decir(donde,
    `Entendido: *${pedido.qty} × ${pedido.item}*, entrega en ${pedido.maxLeadDays} días, `
    + `techo $${techo.toLocaleString('es-CO')} por unidad${pedido.maxPrice ? '' : ' (estimado)'}.`
    + (ultima ? `
_La última vez este canal pagó $${ultima.price.toLocaleString('es-CO')} a ${ultima.seller}._` : '')
    + `
Voy a cotizar con varios proveedores y vuelvo con el mejor.`);

  const id = randomUUID();
  const demand = {
    buyer, owner: quien, item: pedido.item, qty: pedido.qty,
    maxPrice: techo, maxLeadDays: pedido.maxLeadDays,
    budget: saldo ?? PRESUPUESTO_DEMO,
    channel: donde.channel, place: env('MARKET_PLACE', 'Colombia'),
    email: perfil.correo ?? undefined, // para mandarle la copia del contrato
    mode: 'supervised', // en un canal de trabajo, la compra se aprueba con un botón
    brain: pensando(askBrain),
  };
  store.recordAgent(buyer, quien);

  comprar(id, demand, saldo !== null, {
    sink: slack.reporte(donde),
    approve: (req) => slack.approve(req, donde),
  }).catch((e) => slack.decir(donde, `Se me cayó la compra: ${e.message}`));
}

// ── La arena (el coliseo del guardián) ─────────────────────────────────────
let running = false;
let sessionNo = 0;
let exploitNext = false;
let pendingApproval = null;

async function arenaLoop({ mode = 'auto' } = {}) {
  if (running) return;
  running = true;
  while (running) {
    sessionNo++;
    const history = store.closedPrices(); // memoria de mercado, fresca de la base
    const o = new Negotiation({
      onEvent: publish, notary, history,
      record: (deal) => store.saveDeal(deal),
      approve: () => new Promise((resolve) => { pendingApproval = { resolve }; }),
    });

    if (exploitNext && history.length >= 3) {
      exploitNext = false;
      o.addAgent({ name: 'NAIVE-01', owner: 'Tienda San Rafa (modelo débil)', role: 'buyer', budget: 9000, mode: 'auto', maxPrice: 70, qty: 100, naive: true, brain: pensando(mockBrain) });
      o.addAgent({ name: 'GREEDY-02', owner: 'Mayorista Tiburón (modelo fuerte)', role: 'seller', budget: 0, mode: 'auto', minPrice: 55, qty: 100, greedy: true, brain: pensando(mockBrain) });
    } else {
      o.addAgent({ name: 'BUYER-01', owner: 'Tienda Doña Marta', role: 'buyer', budget: 6000, mode, maxPrice: 45, qty: 100, brain: pensando(mockBrain) });
      o.addAgent({ name: 'SELLER-02', owner: 'Distribuidora El Valle', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: pensando(mockBrain) });
    }

    await syncDeposits();
    const externals = joinQueue.splice(0, 2);
    for (const { spec } of externals) {
      store.recordAgent(spec.name, spec.owner);
      busy.add(spec.name);
      o.addAgent({ ...spec, budget: store.balance(spec.name) ?? 0, brain: paced(remote.brain(spec.name)), external: true });
    }

    const fighters = attackerQueue.splice(0, 3);
    for (const f of fighters) {
      const a = makeAttacker(f);
      o.addAgent({ ...a, brain: paced(a.brain) });
      if (labels.has(f.name)) labels.get(f.name).queued = false;
    }

    publish({
      type: 'scenario_start', session: sessionNo,
      fighters: fighters.map((f) => f.name),
      scenery: o.agents.filter((a) => !a.external && !a.attacker).map((a) => a.name),
      balances: o.ledger.snapshot(),
    });
    const result = await o.run({ maxRounds: 8, minRounds: 3 });

    if (result.deal) {
      const acta = await anchor(result.chainHead).catch((e) => ({ error: e.message }));
      publish({ type: 'notarized', ...acta });
    }
    for (const { spec } of externals) {
      store.setBalance(spec.name, o.ledger.available(spec.name));
      busy.delete(spec.name);
    }
    publish({ type: 'scenario_end', session: sessionNo, deal: result.deal, rounds: result.rounds });
    sendBoard();
    await sleep(3000);
  }
}

// Depósitos: se leen de la cadena, nadie los declara. Falla suave.
async function syncDeposits() {
  const { deposits, toBlock } = await incomingTransfers(store.lastBlock())
    .catch(() => ({ deposits: [], toBlock: null }));
  for (const d of deposits) store.recordDeposit(d);
  if (toBlock) store.setLastBlock(toBlock);
  const acreditado = store.settleDeposits();
  if (acreditado) publish({ type: 'deposit', total: acreditado });
  return acreditado;
}

// ── WebSocket ──────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'leaderboard', board: boardRows() }));
  ws.on('close', () => remote.leave(ws));
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Los mandos exigen el token cuando CONTROL_TOKEN está puesto.
    if (!mando.permite(msg)) return ws.send(JSON.stringify({ type: 'denied', reason: 'este control necesita el token de operación' }));

    if (msg.type === 'arena_start') arenaLoop(msg);
    if (msg.type === 'arena_stop') running = false;
    if (msg.type === 'exploit_demo') exploitNext = true;
    if (msg.type === 'approval' && pendingApproval) {
      pendingApproval.resolve({ answer: msg.answer, text: msg.text });
      pendingApproval = null;
    }

    // API abierto: cualquier agente entra a tradear. Lo que NO puede es
    // declarar cuánta plata tiene: su saldo es lo que depositó en el escrow.
    if (msg.type === 'join') {
      const name = String(msg.name ?? '').slice(0, 16).replace(/[^\w-]/g, '') || `EXT-${Date.now() % 1000}`;
      remote.join(name, ws);

      // Reto de identidad: firma esto con la llave de la dirección que dices
      // ser. Sin eso no hay dirección verificada, y sin dirección no hay saldo.
      const dice = /^0x[0-9a-fA-F]{40}$/.test(msg.address ?? '') ? msg.address : null;
      const reto = `mercadia/auth/1|${name}|${randomUUID()}`;
      const probada = dice && (await signedBy(dice, reto, await remote.sign(name, reto))) ? dice : null;
      if (probada) {
        remote.join(name, ws, probada);
        store.setAddress(name, probada);
        await syncDeposits();
      }

      const owner = String(msg.owner ?? name).slice(0, 40);
      store.recordAgent(name, owner);
      const spec = {
        name, role: msg.role === 'seller' ? 'seller' : 'buyer', owner, mode: 'auto',
        budget: store.balance(name) ?? 0,
        qty: entre(msg.qty, 1, 100000, 100),
        maxPrice: Number(msg.maxPrice) || undefined,
        minPrice: Number(msg.minPrice) || undefined,
      };
      joinQueue.push({ spec });
      ws.send(JSON.stringify({
        type: 'joined', name, address: probada, balance: spec.budget,
        note: probada
          ? `entras con $${spec.budget}, lo que depositaste en el escrow`
          : 'sin dirección probada no tienes saldo ni puedes firmar actas: puedes vender, no comprar',
      }));
      publish({ type: 'external_join', name, owner, role: spec.role, balance: spec.budget });
    }

    // Un vendedor publica qué vende y dónde está: así entra al catálogo y al mapa.
    if (msg.type === 'listing') {
      const name = remote.nameOf(ws);
      if (!name) return;
      const item = String(msg.item ?? '').trim().slice(0, 60);
      if (item) publicar(name, String(msg.owner ?? name).slice(0, 40), msg, item);
    }

    // Retiro: la única salida de plata del escrow.
    if (msg.type === 'withdraw') {
      const name = remote.nameOf(ws);
      const address = name && remote.addressOf(name);
      const deny = (reason) => ws.send(JSON.stringify({ type: 'withdrawal_denied', reason }));
      if (!address) return deny('primero entra y prueba tu dirección');
      if (busy.has(name)) return deny('estás negociando: espera a que cierre la sesión');
      const saldo = store.balance(name) ?? 0;
      const monto = Math.min(Math.max(0, Number(msg.amount) || 0), saldo);
      if (monto <= 0) return deny('sin saldo para retirar');

      // Débito primero. Si el envío falla se devuelve; si el proceso se cae en
      // el medio, el error queda del lado de la casa, nunca a favor del que retira.
      store.setBalance(name, saldo - monto);
      const receipt = await withdraw(address, monto).catch((e) => ({ error: e.message }));
      if (receipt.error) store.setBalance(name, (store.balance(name) ?? 0) + monto);
      publish({ type: 'withdrawal', name, amount: monto, receipt });
    }

    if (msg.type === 'action') remote.deliver('your_turn', msg.name, msg, ws);
    if (msg.type === 'signature') remote.deliver('sign_request', msg.name, msg, ws);
  });
});

server.listen(PORT, async () => {
  console.log(`mercadia → ${BASE}  |  agentes: ws ${BASE.replace('http', 'ws')}/ws`);
  const cadena = proveedores().map((p) => `${p.name} (${p.model})`).join(' → ') || 'ninguno';
  console.log(`   modelo: ${cadena} → determinista  ·  exa: ${exaKey() ? 'sí' : 'no'}`);
  console.log(`   controles: ${mando.exige ? 'con token (usa /arena?t=…)' : 'ABIERTOS (sin CONTROL_TOKEN: solo para local)'}`);
  if (ambiguous.activo()) {
    const r = await ambiguous.conectar();
    console.log(r.ok ? `   ambiguous: ${Object.values(r.tools).filter(Boolean).length}/4 espejos resueltos` : `   ambiguous: no conectó (${r.error})`);
  } else {
    console.log('   ambiguous: apagado (falta AMBIGUOUS_API_KEY)');
  }
  if (telegram.activo()) {
    const t = await telegram.escuchar();
    console.log(t.ok ? `   telegram: escuchando como @${t.bot}` : `   telegram: no conectó (${t.error})`);
  } else {
    console.log('   telegram: apagado (falta TELEGRAM_BOT_TOKEN)');
  }
  if (!slack.activo()) return console.log('   slack: apagado (faltan SLACK_APP_TOKEN y SLACK_BOT_TOKEN)');
  const r = await slack.conectar();
  console.log(r.ok ? '   slack: conectado por socket mode' : `   slack: no conectó (${r.error})`);
});
