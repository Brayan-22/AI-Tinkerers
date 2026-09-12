// El agente vive en el canal donde ya se compra.
//
// Socket Mode: Slack abre el websocket hacia nosotros, así que no hace falta
// URL pública, ni túnel, ni webhook. Sin dependencias nuevas: `ws` ya estaba
// para el API de agentes y `fetch` es de la plataforma.
//
// Los botones de autorizar/rechazar son el puerto `approve` del dominio. El
// mismo que servía por correo, ahora en el hilo. El dominio no se enteró.
import { WebSocket } from 'ws';

const API = 'https://slack.com/api';
const plata = (n) => '$' + Number(n ?? 0).toLocaleString('es-CO');

export function slackChannel({
  appToken = process.env.SLACK_APP_TOKEN,
  botToken = process.env.SLACK_BOT_TOKEN,
  onDemand,
  onEvent,
  ttlMs = 10 * 60 * 1000,
} = {}) {
  const pendientes = new Map(); // id de decisión -> { resolve, timer, donde }
  let socket;
  let vivo = false;

  const activo = () => Boolean(appToken && botToken);

  const llamar = (metodo, body) => fetch(`${API}/${metodo}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${botToken}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));

  const decir = (donde, text, blocks) =>
    llamar('chat.postMessage', { channel: donde.channel, thread_ts: donde.thread, text, ...(blocks && { blocks }) });

  async function conectar() {
    if (!activo()) return { ok: false, error: 'faltan SLACK_APP_TOKEN o SLACK_BOT_TOKEN' };
    const abre = await fetch(`${API}/apps.connections.open`, {
      method: 'POST', headers: { authorization: `Bearer ${appToken}` },
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));
    if (!abre.ok) return abre;

    socket = new WebSocket(abre.url);
    socket.on('message', (raw) => {
      let sobre;
      try { sobre = JSON.parse(raw); } catch { return; }
      // Slack reintenta lo que no se confirma: primero el acuse, después pensar.
      if (sobre.envelope_id) socket.send(JSON.stringify({ envelope_id: sobre.envelope_id }));
      if (sobre.type === 'hello') { vivo = true; onEvent?.({ type: 'slack_ready' }); return; }
      if (sobre.type === 'disconnect') { socket.close(); return; }
      manejar(sobre).catch((e) => onEvent?.({ type: 'slack_error', reason: e.message }));
    });
    socket.on('close', () => { vivo = false; setTimeout(conectar, 3000); });
    socket.on('error', () => {});
    return { ok: true };
  }

  async function manejar(sobre) {
    if (sobre.type === 'events_api') {
      const e = sobre.payload?.event ?? {};
      // Nunca contestarse a sí mismo, ni a ediciones ni a hilos de sistema.
      if (e.bot_id || e.subtype) return;
      const esDM = e.type === 'message' && e.channel_type === 'im';
      if (e.type !== 'app_mention' && !esDM) return;
      const texto = String(e.text ?? '').replace(/<@[^>]+>/g, '').trim();
      if (!texto) return;
      const donde = { channel: e.channel, thread: e.thread_ts ?? e.ts, user: e.user };
      await onDemand?.(texto, donde);
      return;
    }

    if (sobre.type === 'interactive') {
      const p = sobre.payload ?? {};
      const accion = p.actions?.[0]?.action_id ?? '';
      const [respuesta, id] = accion.split(':');
      const abierta = pendientes.get(id);
      if (!abierta) return;
      clearTimeout(abierta.timer);
      pendientes.delete(id);
      abierta.resolve({ answer: respuesta === 'si' ? 'si' : 'no', text: `decidido por <@${p.user?.id}> en Slack` });
      // Se reemplaza el mensaje: los botones no se vuelven a usar.
      await llamar('chat.update', {
        channel: p.channel?.id, ts: p.message?.ts,
        text: respuesta === 'si' ? `✅ Autorizado por <@${p.user?.id}>` : `🚫 Rechazado por <@${p.user?.id}>`,
        blocks: [],
      });
    }
  }

  return {
    activo, conectar,
    // Contexto que el canal regala: quién pide, con su nombre y su correo.
    // El correo necesita el scope users:read.email; sin él llega vacío y la
    // copia del contrato simplemente no se envía.
    async quienEs(user) {
      const r = await llamar('users.info', { user });
      return {
        nombre: r?.user?.real_name ?? r?.user?.name ?? null,
        correo: r?.user?.profile?.email ?? null,
      };
    },
    conectado: () => vivo,
    decir,

    // Puerto `approve` del dominio, hablado en Slack.
    approve(req, donde) {
      const id = `ap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const detalle = `${req.qty} × ${req.item} a ${plata(req.price)} c/u\nTotal *${plata(req.total)}*`
        + `${req.leadDays ? ` · entrega en ${req.leadDays} días` : ''}\nProveedor: *${req.seller}*`;
      decir(donde, `Autoriza la compra: ${req.qty} × ${req.item}`, [
        { type: 'section', text: { type: 'mrkdwn', text: `*Tu agente quiere cerrar*\n${detalle}` } },
        {
          type: 'actions',
          elements: [
            { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Autorizar' }, action_id: `si:${id}` },
            { type: 'button', style: 'danger', text: { type: 'plain_text', text: 'Rechazar' }, action_id: `no:${id}` },
          ],
        },
      ]);

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendientes.delete(id);
          decir(donde, `⌛ Nadie autorizó en ${Math.round(ttlMs / 60000)} minutos: el trato se cae.`);
          resolve({ answer: 'no', text: 'venció el plazo de autorización' });
        }, ttlMs);
        pendientes.set(id, { resolve, timer, donde });
      });
    },

    // Traduce los eventos del mercado a mensajes del hilo. Solo lo que una
    // persona quiere leer: no el volcado completo.
    reporte(donde) {
      const cotizadas = [];
      return (ev) => {
        switch (ev.type) {
          case 'discovering':
            return decir(donde, `🔎 Buscando proveedores de *${ev.item}* en la web…`);
          case 'discovered':
            return decir(donde, `Encontré ${ev.suppliers.length} proveedores reales: `
              + ev.suppliers.map((s) => `<${s.url}|${s.owner}> (${s.city})`).join(' · '));
          case 'market_reference':
            return decir(donde, `📊 Referencia de mercado: *${plata(ev.median)}* según ${ev.sources.length} fuentes. `
              + `El guardián ya puede detectar un precio abusivo sin historial.`);
          case 'humans_asked':
            return decir(donde, `📲 Le escribí a *${ev.count}* ${ev.count === 1 ? 'proveedor' : 'proveedores'} de verdad a su celular: `
              + `${ev.who.join(', ')}. Están contestando en texto libre, no son simulaciones.`);
          case 'match_semantico':
            return decir(donde, `No tenía *${ev.item}* con ese nombre exacto, pero en el catálogo eso es ${ev.como.map((c) => `*${c}*`).join(' o ')}. Sigo con eso.`);
          case 'quote_received':
            cotizadas.push(ev);
            return decir(donde, `💬 *${ev.owner ?? ev.seller}* cotiza ${plata(ev.price)} · ${ev.leadDays} días\n_${ev.reason ?? ''}_`);
          case 'no_quote':
            return decir(donde, ev.humano
              ? `📵 *${ev.owner}* no contestó a tiempo. Sigo con los demás; no invento una cotización por él.`
              : `➖ *${ev.owner}* no cotizó (${ev.reason}).`);
          case 'quote_rejected':
            return decir(donde, `✂️ Descarto *${ev.seller}*: ${ev.reason}`);
          case 'exploitation_alert':
            return decir(donde, `🛑 *Te estaban esquilmando.* ${ev.reason}`);
          case 'rfq_empty':
            return decir(donde, ev.cotizadas
              ? `Ninguna de las ${ev.cotizadas} cotizaciones sirve. No cerré nada.`
              : `No tengo proveedores de *${ev.item}* en el catálogo. Que alguien se registre escribiéndole al bot de Telegram: \`/vendo ${ev.item}\``);
          case 'award_failed':
            return decir(donde, `*${ev.seller}* se echó para atrás al final. No cerré nada.`);
          case 'awarded':
            return decir(donde, `🤝 Adjudicado a *${ev.seller}*: ${plata(ev.price)} × ${ev.leadDays} días = *${plata(ev.total)}*`);
          case 'notarized':
            return ev.explorer ? decir(donde, `⛓️ Negociación anclada: <${ev.explorer}|ver en Base Sepolia>`) : undefined;
          case 'contract':
            return decir(donde, `📄 Contrato firmado por las dos partes: <${ev.url}|abrir>`
              + (ev.funded ? '' : '\n_compra de demostración: el comprador no depositó fondos_'));
          default:
            return undefined;
        }
      };
    },
  };
}
