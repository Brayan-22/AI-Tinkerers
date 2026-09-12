// Cerebro LLM: el agente negocia en lenguaje natural de verdad.
//
// Lo importante: la acción estructurada que devuelve pasa por el guardián
// igual que la de cualquiera. Si alucina un precio que no puede pagar, lo
// expulsan por ofertar sin fondos. El LLM nunca es la frontera de seguridad,
// y por eso se le puede dar libertad para hablar.
//
// Dos proveedores en cadena: OpenAI primero, OpenRouter si OpenAI falla, y el
// cerebro determinista si fallan los dos. Misma API de chat en ambos, así que
// la cadena es una lista y no dos códigos.
import { secret, env } from './secrets.js';

const ACCIONES = ['quote', 'offer', 'accept', 'talk', 'reject', 'walk_away'];
const MODELO = env('LLM_MODEL', 'google/gemini-2.5-flash-lite');

export function proveedores() {
  return [
    {
      name: 'deepinfra', key: secret('DEEPINFRA_API_KEY'),
      url: env('DEEPINFRA_BASE_URL', 'https://api.deepinfra.com/v1/openai/chat/completions'),
      model: env('DEEPINFRA_MODEL', 'Qwen/Qwen3-30B-A3B'),
    },
    {
      name: 'openrouter', key: secret('OPENROUTER_API_KEY'),
      url: env('LLM_BASE_URL', 'https://openrouter.ai/api/v1/chat/completions'),
      model: MODELO,
    },
  ].filter((p) => p.key);
}

export function llmKey() {
  return proveedores()[0]?.key ?? null;
}

// Una llamada de chat que recorre la cadena. Devuelve el texto o null; nunca
// lanza: quien llama ya tiene un plan B determinista.
export async function completar(messages, { providers = proveedores(), temperature = 0.7, maxTokens = 220, timeoutMs = 12_000, onFallback } = {}) {
  for (const p of providers) {
    try {
      const res = await fetch(p.url, {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${p.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: p.model, temperature, max_tokens: maxTokens, messages }),
      });
      if (!res.ok) { onFallback?.(p.name, `http ${res.status}`); continue; }
      const data = await res.json();
      const texto = data?.choices?.[0]?.message?.content;
      if (texto) return { texto, proveedor: p.name };
      onFallback?.(p.name, 'respuesta vacía');
    } catch (e) {
      onFallback?.(p.name, e.name === 'TimeoutError' ? 'timeout' : e.message);
    }
  }
  return null;
}

const mandato = (agent, view) => {
  const partes = [
    `Eres ${agent.name}${agent.owner ? ` y trabajas para ${agent.owner}` : ''}.`,
    `Rol: ${agent.role === 'buyer' ? 'comprador' : 'vendedor'}. Producto: ${view.item ?? 'el pedido'}. Cantidad: ${agent.qty}.`,
  ];
  if (agent.maxPrice) partes.push(`Tu techo es $${agent.maxPrice} por unidad. NUNCA ofrezcas más.`);
  if (agent.minPrice) partes.push(`Tu piso es $${agent.minPrice} por unidad. NUNCA cotices menos.`);
  if (agent.maxLeadDays) partes.push(`Necesitas entrega en máximo ${agent.maxLeadDays} días.`);
  if (agent.leadDays) partes.push(`Tu plazo de entrega es ${agent.leadDays} días.`);
  partes.push(`Ronda ${view.round}. Regatea, no aceptes el primer número, pero cierra si el trato te sirve.`);
  if (view.lastQuote) partes.push(`Última cotización sobre la mesa: $${view.lastQuote.price} con entrega en ${view.lastQuote.leadDays} días.`);
  if (view.bestOffer) partes.push(`Hay una oferta firme de $${view.bestOffer.price} (id ${view.bestOffer.id}) que puedes aceptar.`);
  return partes.join(' ');
};

const INSTRUCCION = `Responde SOLO un JSON:
{"text":"lo que le dices a la contraparte, en español, máximo 25 palabras",
 "reason":"por qué haces esto, para tu dueño, máximo 20 palabras",
 "action":{"type":"quote|offer|accept|talk|reject|walk_away","price":number,"qty":number,"leadDays":number,"offerId":"solo si aceptas"}}
Reglas: "quote" cotiza sin comprometer fondos (vendedor). "offer" compromete tu plata (comprador).
"accept" cierra una oferta firme que ya existe. "walk_away" te retira si hay mala fe. Nada de texto fuera del JSON.`;

// Separada para poder probarla sin red: es donde de verdad se puede romper.
export function parseAction(contenido) {
  if (!contenido) return null;
  const limpio = String(contenido).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const desde = limpio.indexOf('{');
  const hasta = limpio.lastIndexOf('}');
  if (desde < 0 || hasta < desde) return null;
  let json;
  try { json = JSON.parse(limpio.slice(desde, hasta + 1)); } catch { return null; }
  const tipo = json?.action?.type;
  if (!ACCIONES.includes(tipo)) return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    text: String(json.text ?? '').slice(0, 300),
    reason: String(json.reason ?? '').slice(0, 300),
    action: {
      type: tipo,
      ...(num(json.action.price) !== undefined && { price: num(json.action.price) }),
      ...(num(json.action.qty) !== undefined && { qty: num(json.action.qty) }),
      ...(num(json.action.leadDays) !== undefined && { leadDays: num(json.action.leadDays) }),
      ...(json.action.offerId && { offerId: String(json.action.offerId) }),
    },
  };
}

// Envuelve un cerebro determinista: si no hay llave, si el modelo se cae o si
// contesta basura, negocia el de siempre. La mesa nunca se queda esperando.
export function llmBrain(fallback, { key, model = MODELO, url, providers, timeoutMs = 12_000, onFallback } = {}) {
  const cadena = providers ?? (key ? [{ name: 'custom', key, model, url: url ?? 'https://openrouter.ai/api/v1/chat/completions' }] : proveedores());
  if (!cadena.length) return fallback;

  return async (agent, view) => {
    try {
      const r = await completar([
        { role: 'system', content: `${mandato(agent, view)}\n\n${INSTRUCCION}` },
        { role: 'user', content: view.lastQuote || view.bestOffer ? 'Tu turno.' : 'Abre la negociación.' },
      ], { providers: cadena, timeoutMs, onFallback });
      const accion = parseAction(r?.texto);
      // El techo y el piso no se negocian con el modelo: se imponen acá.
      if (!accion) return fallback(agent, view);
      if (accion.action.type === 'offer' && agent.maxPrice && accion.action.price > agent.maxPrice) return fallback(agent, view);
      if (accion.action.type === 'quote' && agent.minPrice && accion.action.price < agent.minPrice) return fallback(agent, view);
      // Ofertar compromete fondos: si un vendedor lo hace, el guardián lo
      // expulsa por ofertar sin plata. Cotizar es del vendedor, no del comprador.
      if (accion.action.type === 'offer' && agent.role === 'seller') return fallback(agent, view);
      if (accion.action.type === 'quote' && agent.role === 'buyer') return fallback(agent, view);
      // Si hay una oferta firme que cubre su propio piso y el modelo no la
      // toma, se le quita el teclado: nadie rechaza la plata que él mismo pidió.
      if (view.bestOffer && agent.minPrice && view.bestOffer.price >= agent.minPrice
          && accion.action.type !== 'accept') {
        return fallback(agent, view);
      }
      if (accion.action.qty === undefined && ['offer', 'quote'].includes(accion.action.type)) accion.action.qty = agent.qty;
      if (accion.action.leadDays === undefined && agent.leadDays) accion.action.leadDays = agent.leadDays;
      return accion;
    } catch {
      return fallback(agent, view);
    }
  };
}

// ── Entender un pedido escrito como lo escribe una persona ────────────────
const DIAS = { domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6 };

const numero = (s) => Number(String(s).replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));

// "para el viernes", "en 3 días", "mañana": todo eso son días desde hoy.
export function plazoPorReglas(texto, hoy = new Date(), porDefecto = 7) {
  const bajo = String(texto ?? '').toLowerCase();
  const enDias = bajo.match(/(?:en|dentro de|demoro|demora|entrego en)\s+(\d+)\s*d[íi]as?/);
  if (enDias) return Number(enDias[1]);
  if (/mañana|manana/.test(bajo)) return 1;
  if (/hoy|urgente|ya mismo|de una|inmediat/.test(bajo)) return 1;
  const diaSemana = Object.keys(DIAS).find((d) => bajo.includes(d));
  if (diaSemana) return ((DIAS[diaSemana] - hoy.getDay() + 7) % 7) || 7;
  if (/esta semana/.test(bajo)) return 7;
  if (/pr[óo]xima semana|siguiente semana/.test(bajo)) return 14;
  return porDefecto;
}

// Respaldo determinista: si no hay modelo o contesta mal, igual se entiende
// "necesito 200 botellas de agua para el viernes, máximo $1.500".
export function pedidoPorReglas(texto, hoy = new Date()) {
  const t = String(texto ?? '');
  const bajo = t.toLowerCase();

  const techo = bajo.match(/(?:m[áa]ximo|hasta|tope|no m[áa]s de|menos de)\s*\$?\s*([\d.,]+)/)
    ?? bajo.match(/\$\s?([\d.,]+)/);
  const maxLeadDays = plazoPorReglas(t, hoy);

  // La cantidad es el primer número que no sea un precio.
  const sinPrecios = t.replace(/\$\s?[\d.,]+/g, ' ');
  const cantidad = sinPrecios.match(/\b(\d{1,6})\b/);

  const item = t
    .replace(/^\s*(necesito|quiero|comprar?|cons[íi]gueme|busco|me hace falta|p[íi]deme)\s+/i, '')
    .replace(/\$\s?[\d.,]+/g, ' ')
    .replace(/\b\d{1,6}\b/, ' ')
    .replace(/(?:para|antes de|entrega|en)\s+(?:el\s+)?(?:lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|mañana|manana|hoy|\d+\s*d[íi]as?|esta semana)/gi, ' ')
    .replace(/(?:m[áa]ximo|hasta|tope|no m[áa]s de|menos de|urgente|por favor|c\/u|cada uno|la unidad)/gi, ' ')
    .replace(/[,.;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    item: item.slice(0, 60) || null,
    qty: cantidad ? Number(cantidad[1]) : 100,
    maxPrice: techo ? numero(techo[1]) : null,
    maxLeadDays,
  };
}

// ── Entender la respuesta de un proveedor humano ──────────────────────────
// "te la dejo en 1.200 y te la mando el jueves" tiene que volverse una
// cotización estructurada. Esto es el corazón del asunto: un canal humano
// sin API se comporta como una API.
export function cotizacionPorReglas(texto, hoy = new Date()) {
  const t = String(texto ?? '');
  const bajo = t.toLowerCase();
  if (/no (?:tengo|manejo|hay|me queda|trabajo)|agotad|sin stock|no vendo|no puedo/.test(bajo)) {
    return { price: null, leadDays: null, rechaza: true };
  }
  const conMoneda = t.match(/\$\s?([\d.,]+)/) ?? bajo.match(/([\d.,]+)\s*(?:pesos|cop|mil)/);
  const suelto = bajo.match(/(?:a|en|por|vale|cuesta|queda en|dejo en)\s+([\d.,]{3,})/);
  const crudo = conMoneda ?? suelto ?? t.match(/\b([\d.,]{3,})\b/);
  const price = crudo ? numero(crudo[1]) : null;
  return {
    price: Number.isFinite(price) && price > 0 ? price : null,
    leadDays: plazoPorReglas(t, hoy, null),
    rechaza: false,
  };
}

export async function extraerCotizacion(texto, { providers = proveedores() } = {}) {
  const reglas = cotizacionPorReglas(texto);
  if (!providers.length) return { ...reglas, via: 'reglas' };
  try {
    const r = await completar([{
      role: 'system',
      content: `Hoy es ${new Date().toISOString().slice(0, 10)} (${new Date().toLocaleDateString('es-CO', { weekday: 'long' })}).
Un proveedor contestó a una solicitud de cotización. Extrae SOLO JSON:
{"price":precio por unidad como number o null,"leadDays":días hasta la entrega como number o null,"rechaza":true si dice que no tiene o no puede}
El precio es por unidad. Si da un total, divídelo si sabes la cantidad; si no, déjalo como está.`,
    }, { role: 'user', content: String(texto).slice(0, 500) }], { providers, temperature: 0, maxTokens: 120, timeoutMs: 10_000 });
    if (!r) return { ...reglas, via: 'reglas' };
    const bruto = String(r.texto);
    const json = JSON.parse(bruto.slice(bruto.indexOf('{'), bruto.lastIndexOf('}') + 1));
    return {
      price: Number(json.price) > 0 ? Number(json.price) : reglas.price,
      leadDays: Number(json.leadDays) > 0 ? Number(json.leadDays) : reglas.leadDays,
      rechaza: Boolean(json.rechaza) || reglas.rechaza,
      via: r.proveedor,
    };
  } catch {
    return { ...reglas, via: 'reglas' };
  }
}

export async function extraerPedido(texto, { providers = proveedores() } = {}) {
  const reglas = pedidoPorReglas(texto);
  if (!providers.length) return { ...reglas, via: 'reglas' };
  try {
    const r = await completar([{
      role: 'system',
      content: `Hoy es ${new Date().toISOString().slice(0, 10)}. Extrae el pedido de compra y responde SOLO JSON:
{"item":"qué quiere comprar, tal como lo diría, sin la cantidad","qty":number,"maxPrice":number o null,"maxLeadDays":number}
maxPrice es por unidad. maxLeadDays son días desde hoy hasta la entrega.`,
    }, { role: 'user', content: String(texto).slice(0, 500) }], { providers, temperature: 0, maxTokens: 150, timeoutMs: 10_000 });
    if (!r) return { ...reglas, via: 'reglas' };
    const bruto = String(r.texto);
    const json = JSON.parse(bruto.slice(bruto.indexOf('{'), bruto.lastIndexOf('}') + 1));
    if (!json?.item) return { ...reglas, via: 'reglas' };
    return {
      item: String(json.item).slice(0, 60),
      qty: Number(json.qty) > 0 ? Number(json.qty) : reglas.qty,
      maxPrice: Number(json.maxPrice) > 0 ? Number(json.maxPrice) : reglas.maxPrice,
      maxLeadDays: Number(json.maxLeadDays) > 0 ? Number(json.maxLeadDays) : reglas.maxLeadDays,
      via: r.proveedor,
    };
  } catch {
    return { ...reglas, via: 'reglas' };
  }
}

// ── Entender que "sillas" y "muebles de oficina" son lo mismo ──────────────
// El texto exacto no alcanza: quien compra no usa las palabras de quien vende.
// El catálogo es pequeño, así que se le pasa entero al modelo y decide cuáles
// son el mismo producto. Si no hay modelo o contesta mal, no pasa nada: el
// que llama ya trae su coincidencia por texto.
export async function emparejarItem(consulta, items, { providers = proveedores() } = {}) {
  const lista = [...new Set(items)].filter(Boolean).slice(0, 60);
  if (!providers.length || !lista.length) return [];
  try {
    const r = await completar([{
      role: 'system',
      content: `Alguien quiere comprar algo. Te doy el catálogo de un mercado.
Devuelve SOLO los productos del catálogo que sean ESE MISMO producto, aunque
se digan distinto (singular/plural, sinónimos, marcas, variantes).
No incluyas productos que solo estén relacionados: "sillas" NO es "escritorios".
Responde SOLO JSON: {"coinciden":["texto exacto del catálogo", ...]}`,
    }, {
      role: 'user',
      content: `Quiere comprar: ${String(consulta).slice(0, 80)}\nCatálogo:\n${lista.map((i) => `- ${i}`).join('\n')}`,
    }], { providers, temperature: 0, maxTokens: 200, timeoutMs: 9000 });
    if (!r) return [];
    const bruto = String(r.texto);
    const json = JSON.parse(bruto.slice(bruto.indexOf('{'), bruto.lastIndexOf('}') + 1));
    // Solo se acepta lo que existe de verdad en el catálogo.
    return (json?.coinciden ?? []).filter((x) => lista.includes(x));
  } catch {
    return [];
  }
}
