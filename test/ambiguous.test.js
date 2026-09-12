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

test('ambiguous: encuentra los espejos por patrón y apaga los que no existen', async () => {
  servidorFalso([{ name: 'sheets.appendRow' }, { name: 'crm.upsertContact' }, { name: 'docs.create' }]);
  const a = ambiguousChannel({ token: 'k', url: 'https://x/mcp' });
  const r = await a.conectar();
  assert.equal(r.ok, true);
  assert.equal(a.tools().fila, 'sheets.appendRow');
  assert.equal(a.tools().crm, 'crm.upsertContact');
  assert.equal(a.tools().firma, null, 'sin herramienta de firma, ese espejo no existe');
});

test('ambiguous: un espejo caído no tumba la compra', async () => {
  const eventos = [];
  servidorFalso([{ name: 'sheets.appendRow' }]);
  const a = ambiguousChannel({ token: 'k', url: 'https://x/mcp', onEvent: (e) => eventos.push(e) });
  await a.conectar();
  globalThis.fetch = async () => { throw new Error('se cayó'); };
  const registro = a.registro({ item: 'agua', qty: 100 });
  await registro({ type: 'quote_received', seller: 'A', price: 40, leadDays: 2 });
  assert.ok(eventos.some((e) => e.type === 'ambiguous_error'), 'se registra el error');
  assert.equal(await registro({ type: 'contract', seller: 'A', url: 'u' }), null, 'sin herramienta de firma ni correo, no hace nada y no lanza');
});

test('ambiguous: sin llave no toca la red', async () => {
  const a = ambiguousChannel({ token: null });
  assert.equal(a.activo(), false);
  assert.equal((await a.conectar()).ok, false);
});
