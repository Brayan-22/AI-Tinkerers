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
import { readFileSync, existsSync } from 'node:fs';
import { mcpClient } from './mcp.client.js';
import { secret, env } from './secrets.js';

// El CLI (`npx ambiguous auth signup`) ya deja la llave en .ambi/config.json.
// Se lee de ahí si no está en el entorno, para no copiarla a mano a dos sitios.
function llaveDelCli() {
  const archivo = new URL('../../.ambi/config.json', import.meta.url).pathname;
  if (!existsSync(archivo)) return null;
  try { return JSON.parse(readFileSync(archivo, 'utf8')).authToken ?? null; }
  catch { return null; }
}

// Nombres reales del servidor, verificados contra tools/list (856 herramientas).
// La convención es verbo_sustantivo, no namespace.verbo.
// ponytail: `npm run ambiguous:tools` los vuelve a listar si cambian.
const HERRAMIENTAS = {
  hoja: 'create_sheet',          // el libro de cotizaciones de esta compra
  fila: 'append_sheet_values',   // una fila por cotización y por descarte
  contacto: 'create_contact',    // el proveedor con quien se cerró
  trato: 'create_deal',          // la compra, con su monto
  contrato: 'create_document',   // el contrato como documento del workspace
  correo: 'send_email',          // la copia al comprador
};

// No existe herramienta de firma electrónica en el servidor: el contrato queda
// como documento del workspace. Las dos firmas criptográficas del acta viven
// en el contrato que sirve Mercadia, no acá.

export function ambiguousChannel({ token = secret('AMBIGUOUS_API_KEY') ?? llaveDelCli(), url = env('AMBIGUOUS_MCP_URL', 'https://app.ambiguous.ai/mcp'), onEvent } = {}) {
  const activo = () => Boolean(token);
  let client = null;
  let herramientas = {};

  async function conectar() {
    if (!activo()) return { ok: false, error: 'falta AMBIGUOUS_API_KEY' };
    try {
      client = mcpClient({ url, token });
      await client.connect();
      const lista = await client.tools();
      const hay = new Set(lista.map((t) => t.name));
      herramientas = Object.fromEntries(Object.entries(HERRAMIENTAS).map(([rol, nombre]) => [rol, hay.has(nombre) ? nombre : null]));
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

    // Traduce los eventos de la compra al sistema de registro. Cada compra abre
    // su propio libro de cotizaciones; el resto cuelga de ahí.
    registro(demand) {
      let libro = null;
      const fila = (valores) => (libro ? espejo('fila', { id: libro, range: 'A1', values: [valores] }) : null);

      return async (ev) => {
        switch (ev.type) {
          case 'rfq_open': {
            const r = await espejo('hoja', { title: `Cotizaciones · ${demand.qty} × ${demand.item}`, visibility: 'workspace' });
            libro = idDe(r);
            return fila(['Proveedor', 'Precio unidad', 'Entrega (días)', 'Estado', 'Razón']);
          }
          case 'quote_received':
            return fila([ev.seller, ev.price, ev.leadDays, 'cotizó', ev.reason ?? '']);
          case 'quote_rejected':
            return fila([ev.seller, ev.price, ev.leadDays, 'descartada', ev.reason]);
          case 'awarded': {
            await espejo('contacto', { type: 'company', name: ev.seller, lifecycle_stage: 'customer' });
            return espejo('trato', {
              title: `${demand.qty} × ${demand.item} — ${ev.seller}`,
              amount: ev.total, currency: 'COP', status: 'won',
            });
          }
          case 'contract': {
            await espejo('contrato', {
              type: 'doc', visibility: 'workspace',
              title: `Contrato · ${demand.item} · ${ev.seller}`,
              content: `Compra de ${demand.qty} × ${demand.item} cerrada con ${ev.seller}.\n\nContrato firmado por las dos partes: ${ev.url}`,
            });
            if (!demand.email) return null;
            return espejo('correo', {
              to: [demand.email],
              subject: `Contrato cerrado: ${demand.qty} × ${demand.item}`,
              body_markdown: `Cerraste con **${ev.seller}**.\n\n[Ver el contrato firmado](${ev.url})`,
            });
          }
          default:
            return null;
        }
      };
    },
  };
}

// El id del documento recién creado viene dentro del contenido de la respuesta
// MCP, que es texto. Se saca sin inventar formato: si no aparece, no hay libro
// y las filas simplemente no se escriben.
function idDe(respuesta) {
  const texto = respuesta?.content?.map?.((c) => c.text ?? '').join(' ') ?? '';
  try {
    const j = JSON.parse(texto);
    return j.id ?? j.document?.id ?? j.sheet?.id ?? null;
  } catch {
    return texto.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? null;
  }
}
