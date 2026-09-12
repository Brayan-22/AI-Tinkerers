// Autorización por correo: el agente no cierra solo, le escribe al dueño y
// espera. El enlace lleva una firma HMAC, así que adivinar un id no alcanza
// para decidir por otro. Si nadie contesta a tiempo, la respuesta es no.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { secret } from './secrets.js';

const iguales = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

const escapar = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function emailApprovals({ secret, baseUrl = '', send, ttlMs = 10 * 60 * 1000, onEvent } = {}) {
  const pendientes = new Map();
  const firmar = (id) => createHmac('sha256', secret ?? 'mercadia-dev').update(id).digest('hex').slice(0, 32);
  const aviso = (ev) => onEvent?.(ev);

  return {
    pending: () => [...pendientes.entries()].map(([id, p]) => ({ id, ...p.req })),

    // Puerto `approve` del dominio.
    async approve(req) {
      const id = randomUUID();
      const token = firmar(id);
      const enlace = (answer) => `${baseUrl}/api/decision/${id}/${answer}/${token}`;
      const envio = await send?.({
        to: req.email,
        subject: `Autoriza la compra: ${req.qty} × ${req.item}`,
        html: `<p>Tu agente <b>${escapar(req.agent)}</b> quiere cerrar con <b>${escapar(req.seller)}</b>.</p>
               <p>${escapar(req.qty)} × ${escapar(req.item)} a $${escapar(req.price)} c/u — total <b>$${escapar(req.total)}</b>,
               entrega en ${escapar(req.leadDays)} días.</p>
               <p><a href="${enlace('si')}">Autorizar</a> · <a href="${enlace('no')}">Rechazar</a></p>`,
      }).catch((e) => ({ error: e.message }));

      aviso({
        type: 'approval_email', id, item: req.item, seller: req.seller, total: req.total,
        to: req.email ?? null,
        // Sin correo configurado el enlace va a la pantalla: una demo con un
        // correo que nunca llega no es una demo.
        link: envio?.sent ? null : enlace('si'), rejectLink: envio?.sent ? null : enlace('no'),
        note: envio?.error ?? (envio?.sent ? 'correo enviado' : 'sin correo configurado: decide desde la pantalla'),
      });

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendientes.delete(id);
          aviso({ type: 'approval_timeout', id, item: req.item, seller: req.seller });
          resolve({ answer: 'no', text: `nadie autorizó en ${Math.round(ttlMs / 60000)} minutos` });
        }, ttlMs);
        pendientes.set(id, { resolve, timer, req });
      });
    },

    // Lo que llega cuando el dueño hace clic en el correo.
    decide(id, answer, token) {
      const p = pendientes.get(id);
      if (!p) return { ok: false, reason: 'esa decisión ya no está abierta' };
      if (!iguales(token, firmar(id))) return { ok: false, reason: 'enlace inválido' };
      clearTimeout(p.timer);
      pendientes.delete(id);
      const decision = answer === 'si' ? 'si' : 'no';
      p.resolve({ answer: decision });
      aviso({ type: 'approval_decided', id, answer: decision, item: p.req.item, seller: p.req.seller });
      return { ok: true, answer: decision, req: p.req };
    },
  };
}

// Envío real por HTTP, sin dependencias. Si no hay llave, no se inventa nada:
// el enlace sale por pantalla y se decide desde ahí.
export function mailer({ apiKey = secret('MAIL_API_KEY'), from = process.env.MAIL_FROM } = {}) {
  return async ({ to, subject, html }) => {
    if (!apiKey || !to) return { sent: false };
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: from ?? 'mercadia@example.com', to, subject, html }),
    });
    return res.ok ? { sent: true } : { sent: false, error: `el correo fue rechazado (${res.status})` };
  };
}
