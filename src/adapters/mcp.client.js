// Cliente MCP mínimo sobre HTTP (transporte "streamable"): JSON-RPC por POST,
// respuesta en JSON o en SSE. Sin dependencias: es fetch y tres métodos.
// Sirve para cualquier servidor MCP, no solo Ambiguous.
export function mcpClient({ url, token, timeoutMs = 15_000 }) {
  let sesion = null;
  let seq = 0;

  async function rpc(method, params = {}, esNotificacion = false) {
    const body = { jsonrpc: '2.0', method, params, ...(esNotificacion ? {} : { id: ++seq }) };
    const res = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sesion && { 'mcp-session-id': sesion }),
      },
      body: JSON.stringify(body),
    });
    sesion = res.headers.get('mcp-session-id') ?? sesion;
    if (esNotificacion) return null;
    if (!res.ok) throw new Error(`mcp ${method}: http ${res.status}`);

    const tipo = res.headers.get('content-type') ?? '';
    const texto = await res.text();
    const mensajes = tipo.includes('text/event-stream')
      ? texto.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5).trim()))
      : [JSON.parse(texto)];
    const respuesta = mensajes.find((m) => m.id === body.id) ?? mensajes[0];
    if (respuesta?.error) throw new Error(`mcp ${method}: ${respuesta.error.message ?? JSON.stringify(respuesta.error)}`);
    return respuesta?.result;
  }

  return {
    async connect() {
      const r = await rpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'mercadia', version: '1.0.0' },
      });
      await rpc('notifications/initialized', {}, true);
      return r;
    },
    async tools() { return (await rpc('tools/list')).tools ?? []; },
    async call(name, args = {}) { return rpc('tools/call', { name, arguments: args }); },
  };
}
