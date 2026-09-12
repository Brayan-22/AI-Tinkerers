// El otro lado del mercado: el proveedor, en su propio celular.
//
// Acá está el cambio de fondo. El agente no negocia contra vendedores que
// nosotros simulamos: le escribe a personas reales por Telegram, en texto
// libre, como les escribiría un comprador humano. El proveedor no instala
// nada, no sabe que es un agente y no le importa.
//
// Long polling con timeout de 28 s: sin URL pública, sin túnel, sin webhook.
// Telegram guarda los updates 24 h, así que un reinicio no pierde mensajes.
const API = 'https://api.telegram.org/bot';

export function telegramChannel({ token = process.env.TELEGRAM_BOT_TOKEN, onMessage, onEvent } = {}) {
  const esperando = new Map(); // chatId -> resolve, cuando le pedimos algo concreto
  let offset = 0;
  let corriendo = false;

  const activo = () => Boolean(token);

  const api = (metodo, body) => fetch(`${API}${token}/${metodo}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch((e) => ({ ok: false, description: e.message }));

  const decir = (chatId, text) => api('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });

  // Le preguntamos algo y esperamos SU siguiente mensaje. Si no contesta, la
  // mesa sigue sin él: una persona lenta no puede congelar el mercado.
  const esperar = (chatId, timeoutMs = 120_000) => new Promise((resolve) => {
    const clave = String(chatId);
    const previo = esperando.get(clave);
    if (previo) previo(null); // solo una pregunta abierta por proveedor
    const timer = setTimeout(() => { esperando.delete(clave); resolve(null); }, timeoutMs);
    esperando.set(clave, (texto) => { clearTimeout(timer); esperando.delete(clave); resolve(texto); });
  });

  async function escuchar() {
    if (!activo() || corriendo) return { ok: false, error: 'sin TELEGRAM_BOT_TOKEN' };
    const yo = await api('getMe');
    if (!yo.ok) return { ok: false, error: yo.description ?? 'token rechazado' };
    corriendo = true;
    onEvent?.({ type: 'telegram_ready', bot: yo.result?.username });

    (async () => {
      while (corriendo) {
        const r = await api('getUpdates', { offset, timeout: 28, allowed_updates: ['message'] });
        if (!r.ok) { await new Promise((s) => setTimeout(s, 2000)); continue; }
        for (const u of r.result ?? []) {
          offset = u.update_id + 1;
          const m = u.message;
          if (!m?.text || m.from?.is_bot) continue;
          const quien = {
            chat: String(m.chat.id),
            name: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || 'Proveedor',
          };
          const pendiente = esperando.get(quien.chat);
          if (pendiente) pendiente(m.text); // era la respuesta a nuestra pregunta
          else await onMessage?.(m.text, quien);
        }
      }
    })().catch((e) => onEvent?.({ type: 'telegram_error', reason: e.message }));

    return { ok: true, bot: yo.result?.username };
  }

  return { activo, escuchar, decir, esperar, detener() { corriendo = false; } };
}
