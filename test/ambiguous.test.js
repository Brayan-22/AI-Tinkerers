import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambiguousChannel } from '../src/adapters/channel.ambiguous.js';
import { mcpClient } from '../src/adapters/mcp.client.js';

const servidorFalso = (tools, { sse = false } = {}) => {
  const llamadas = [];
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    llamadas.push(req);
    const result = req.method === 'tools/list' ? { tools } : req.method === 'tools/call' ? { content: [{ type: 'text', text: 'ok' }] } : { serverInfo: { name: 'falso' } };
    const cuerpo = JSON.stringify({ jsonrpc: '2.0', id: req.id, result });
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', sse ? 'text/event-stream' : 'application/json'], ['mcp-session-id', 's1']]),
      text: async () => (sse ? `event: message\ndata: ${cuerpo}\n\n` : cuerpo),
    };
  };
  return llamadas;
};

test('mcp: inicializa, lista y llama, y entiende respuestas en SSE', async () => {
  const llamadas = servidorFalso([{ name: 'sheets.appendRow' }], { sse: true });
  const c = mcpClient({ url: 'https://x/mcp', token: 't' });
  await c.connect();
  assert.deepEqual((await c.tools()).map((t) => t.name), ['sheets.appendRow']);
  await c.call('sheets.appendRow', { values: [1] });
  assert.deepEqual(llamadas.map((l) => l.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  assert.equal(llamadas[1].id, undefined, 'la notificación no lleva id');
});

test('ambiguous: solo usa las herramientas que el servidor declara', async () => {
  servidorFalso([{ name: 'append_sheet_values' }, { name: 'create_contact' }, { name: 'otra_cosa' }]);
  const a = ambiguousChannel({ token: 'k', url: 'https://x/mcp' });
  const r = await a.conectar();
  assert.equal(r.ok, true);
  assert.equal(a.tools().fila, 'append_sheet_values');
  assert.equal(a.tools().contacto, 'create_contact');
  assert.equal(a.tools().correo, null, 'lo que el servidor no declara queda apagado');
});

test('ambiguous: un espejo caído no tumba la compra', async () => {
  const eventos = [];
  servidorFalso([{ name: 'create_sheet' }, { name: 'append_sheet_values' }]);
  const a = ambiguousChannel({ token: 'k', url: 'https://x/mcp', onEvent: (e) => eventos.push(e) });
  await a.conectar();
  const registro = a.registro({ item: 'agua', qty: 100 });
  globalThis.fetch = async () => { throw new Error('se cayó'); };
  await registro({ type: 'rfq_open', item: 'agua' });
  assert.ok(eventos.some((e) => e.type === 'ambiguous_error'), 'se registra el error');
  assert.equal(await registro({ type: 'contract', seller: 'A', url: 'u' }), null, 'sin contrato ni correo declarados, no hace nada y no lanza');
});

test('ambiguous: sin llave no toca la red', async () => {
  const a = ambiguousChannel({ token: null });
  assert.equal(a.activo(), false);
  assert.equal((await a.conectar()).ok, false);
});
