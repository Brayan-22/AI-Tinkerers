// Agentes externos: el puente entre un websocket y la interfaz de cerebro.
// La identidad la define el canal — el nombre sale del socket con el que
// entraste, nunca de lo que diga el mensaje.
export function remoteAgents({ turnMs = 10_000 } = {}) {
  const sockets = new Map(); // name -> ws
  const address = new Map(); // name -> 0x…
  const pending = new Map(); // `${kind}:${name}` -> resolve

  // Le pregunta algo al agente y se rinde a los turnMs. Si no contesta, pasa
  // el turno; no puede congelar el mercado de los demás.
  const ask = (kind, name, payload, fallback) => new Promise((resolve) => {
    const ws = sockets.get(name);
    if (!ws) return resolve(fallback);
    const key = `${kind}:${name}`;
    const timer = setTimeout(() => { pending.delete(key); resolve(fallback); }, turnMs);
    pending.set(key, (value) => { clearTimeout(timer); pending.delete(key); resolve(value); });
    try { ws.send(JSON.stringify({ type: kind, name, ...payload })); }
    catch { clearTimeout(timer); pending.delete(key); resolve(fallback); }
  });

  return {
    join(name, ws, addr) { sockets.set(name, ws); if (addr) address.set(name, addr); },
    leave(ws) { for (const [name, s] of sockets) if (s === ws) sockets.delete(name); },
    has: (name) => sockets.has(name),
    nameOf(ws) { for (const [name, s] of sockets) if (s === ws) return name; return undefined; },
    addressOf: (name) => address.get(name),

    brain: (name) => (agent, view) =>
      ask('your_turn', name, { view }, { text: '…', action: { type: 'talk' }, reason: 'no contestó a tiempo' }),

    sign: (name, message) =>
      ask('sign_request', name, { message }, null).then((r) => r?.signature ?? null),

    // El canal define la identidad: solo el socket con el que entró ese
    // nombre puede contestar por ese nombre. Decirlo en el mensaje no basta.
    deliver(kind, name, value, ws) {
      if (sockets.get(name) !== ws) return false;
      const resolve = pending.get(`${kind}:${name}`);
      if (resolve) resolve(value);
      return Boolean(resolve);
    },
  };
}
