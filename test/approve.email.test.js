import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailApprovals } from '../src/adapters/approve.email.js';

const pedido = { agent: 'TIENDA-01', seller: 'AGUA-BOG', item: 'botellas de agua', qty: 100, price: 43, total: 4300, leadDays: 2, email: 'duena@tienda.co' };

function arma(over = {}) {
  const eventos = [];
  const correos = [];
  const a = emailApprovals({
    secret: 'secreto', baseUrl: 'http://x', ttlMs: 5000,
    send: async (m) => { correos.push(m); return { sent: false }; },
    onEvent: (e) => eventos.push(e),
    ...over,
  });
  // El correo se manda antes de avisar, así que hay que dejar correr un tick.
  const pedir = async (req = pedido) => {
    const espera = a.approve(req);
    while (!eventos.some((e) => e.type === 'approval_email')) await new Promise((r) => setImmediate(r));
    const ev = eventos.find((e) => e.type === 'approval_email');
    return { espera, id: ev.id, token: ev.link?.split('/').pop() ?? null, ev };
  };
  return { a, eventos, correos, pedir };
}

test('correo: autorizar con el enlace bueno cierra la decisión', async () => {
  const { a, pedir } = arma();
  const { espera, id, token } = await pedir();
  assert.equal(a.decide(id, 'si', token).ok, true);
  assert.deepEqual(await espera, { answer: 'si' });
});

test('correo: un token que no corresponde no decide nada', async () => {
  const { a, pedir } = arma();
  const { espera, id, token } = await pedir();
  const malo = a.decide(id, 'si', 'a'.repeat(32));
  assert.equal(malo.ok, false);
  assert.match(malo.reason, /inválido/);
  assert.equal(a.pending().length, 1, 'la decisión sigue abierta');
  a.decide(id, 'no', token);
  assert.equal((await espera).answer, 'no');
});

test('correo: una decisión ya tomada no se vuelve a tomar', async () => {
  const { a, pedir } = arma();
  const { espera, id, token } = await pedir();
  a.decide(id, 'si', token);
  assert.equal(a.decide(id, 'no', token).ok, false, 'el enlace sirve una sola vez');
  assert.equal((await espera).answer, 'si');
});

test('correo: si nadie contesta, la respuesta es no', async () => {
  const { a } = arma({ ttlMs: 60, send: async () => ({ sent: true }) });
  const res = await a.approve(pedido);
  assert.equal(res.answer, 'no');
  assert.match(res.text, /nadie autorizó/);
  assert.equal(a.pending().length, 0);
});

test('correo: se manda a la dueña con el detalle de la compra', async () => {
  const { correos, pedir, eventos } = arma({ ttlMs: 60, send: async (m) => { correos.push(m); return { sent: true }; } });
  const { espera } = await pedir();
  assert.equal(correos[0].to, 'duena@tienda.co');
  assert.match(correos[0].subject, /botellas de agua/);
  assert.match(correos[0].html, /AGUA-BOG/);
  assert.equal(eventos[0].link, null, 'si el correo salió, el enlace no se publica en pantalla');
  assert.equal((await espera).answer, 'no', 'y vence solo');
});
