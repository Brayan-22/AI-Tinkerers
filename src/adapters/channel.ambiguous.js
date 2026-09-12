// Ambiguous AI como sistema de registro del comprador.
//
// No reemplaza a Slack: la persona sigue pidiendo donde ya trabaja. Lo que
// hace es que cada compra deje huella en el espacio de trabajo del agente:
// el proveedor en el CRM con lo que se le pagó, cada cotización como fila
// del libro, el contrato a firma de las dos partes y el correo con la copia.
//
// Los nombres exactos de las herramientas los publica el servidor en
// tools/list. Acá se buscan por patrón y, si una no existe, ese espejo se
// apaga solo. Nada de esto está en el camino crítico de la compra.
// ponytail: `npm run ambiguous:tools` imprime la lista real; si un patrón no
// pega, se ajusta el mapa de abajo en un minuto.
import { mcpClient } from './mcp.client.js';
import { secret } from './secrets.js';

const PATRONES = {
  crm: /^crm[._-].*(upsert|create|add|new).*(contact|compan|account|deal)/i,
  fila: /^sheets[._-].*(append|add|insert).*(row|rows)?/i,
  firma: /^sign[._-].*(create|send|request|new)/i,
  correo: /^mail[._-].*send/i,
};

export function ambiguousChannel({ token = secret('AMBIGUOUS_API_KEY'), url = process.env.AMBIGUOUS_MCP_URL ?? 'https://app.ambiguous.ai/mcp', onEvent } = {}) {
  const activo = () => Boolean(token);
  let client = null;
  let herramientas = {};

  async function conectar() {
    if (!activo()) return { ok: false, error: 'falta AMBIGUOUS_API_KEY' };
    try {
      client = mcpClient({ url, token });
      await client.connect();
      const lista = await client.tools();
      herramientas = Object.fromEntries(Object.entries(PATRONES).map(([rol, re]) => [rol, lista.find((t) => re.test(t.name))?.name ?? null]));
      onEvent?.({ type: 'ambiguous_ready', tools: herramientas, total: lista.length });
      return { ok: true, tools: herramientas, lista };
    } catch (e) {
      client = null;
      return { ok: false, error: e.message };
    }
  }

  // Llamada que nunca tumba la compra: si el espejo falla, se registra y sigue.
  async function espejo(rol, args) {
    const nombre = herramientas[rol];
    if (!client || !nombre) return null;
    try { return await client.call(nombre, args); }
    catch (e) { onEvent?.({ type: 'ambiguous_error', rol, tool: nombre, reason: e.message }); return null; }
  }

  return {
    activo, conectar,
    tools: () => herramientas,

    // Traduce los eventos de la compra al sistema de registro.
    registro(demand) {
      return async (ev) => {
        switch (ev.type) {
          case 'quote_received':
            return espejo('fila', { title: `Cotizaciones · ${demand.item}`, values: [ev.seller, ev.price, ev.leadDays, 'cotizó', ev.reason ?? ''] });
          case 'quote_rejected':
            return espejo('fila', { title: `Cotizaciones · ${demand.item}`, values: [ev.seller, ev.price, ev.leadDays, 'descartada', ev.reason] });
          case 'awarded':
            return espejo('crm', { name: ev.seller, notes: `Adjudicado ${demand.qty} × ${demand.item} a $${ev.price}/u, entrega ${ev.leadDays} días. Total $${ev.total}.` });
          case 'contract':
            await espejo('firma', { title: `Contrato · ${demand.item} · ${ev.seller}`, url: ev.url, signers: [demand.email, ev.seller].filter(Boolean) });
            return espejo('correo', { to: demand.email, subject: `Contrato cerrado: ${demand.qty} × ${demand.item}`, body: `Contrato firmado con ${ev.seller}: ${ev.url}` });
          default:
            return null;
        }
      };
    },
  };
}
