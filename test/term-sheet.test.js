import { test } from 'node:test';
import assert from 'node:assert/strict';
import { link, termSheet, canonical } from '../src/market/term-sheet.js';
import { Negotiation } from '../src/market/negotiation.js';
import { mockBrain } from '../src/adapters/brain.mock.js';

// Notario de prueba: misma forma que el real (viem), sin claves.
const notary = {
  async sign(name, msg) { return `sig:${name}:${msg.length}`; },
  async verify(name, msg, sig) { return sig === `sig:${name}:${msg.length}`; },
};
const forger = { async sign() { return 'firma-falsa'; }, async verify() { return false; } };

test('term-sheet: editar un mensaje rompe la cadena de hashes', () => {
  const a = ['hola', 'te doy $42', 'trato'].reduce((h, m) => link(h, m), '');
  const b = ['hola', 'te doy $43', 'trato'].reduce((h, m) => link(h, m), '');
  assert.notEqual(a, b);
});

test('term-sheet: borrar un mensaje rompe la cadena de hashes', () => {
  const a = ['hola', 'te doy $42', 'trato'].reduce((h, m) => link(h, m), '');
  const b = ['hola', 'trato'].reduce((h, m) => link(h, m), '');
  assert.notEqual(a, b);
});

test('term-sheet: la forma canónica no depende del orden de las claves', () => {
  const base = { id: 'n1', buyer: 'B', seller: 'S', price: 42, qty: 100, chainHead: '0xab', closedAt: 1 };
  const a = termSheet(base);
  const b = termSheet({ closedAt: 1, qty: 100, chainHead: '0xab', seller: 'S', price: 42, buyer: 'B', id: 'n1' });
  assert.equal(canonical(a), canonical(b));
  assert.equal(a.total, 4200);
});

test('negociación: el trato se liquida solo con las dos firmas válidas', async () => {
  const o = new Negotiation({ notary });
  o.addAgent({ name: 'BUYER-01', role: 'buyer', budget: 6000, mode: 'auto', maxPrice: 45, qty: 100, brain: mockBrain });
  o.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
  const { deal } = await o.run({ maxRounds: 20, minRounds: 3 });
  assert.ok(deal, 'debe cerrar');
  assert.ok(deal.sheet.signatures['BUYER-01'] && deal.sheet.signatures['SELLER-02']);
  assert.equal(deal.sheet.chainHead, o.chainHead);
});

test('negociación: firma inválida suspende el trato y devuelve el escrow', async () => {
  const o = new Negotiation({ notary: forger });
  o.addAgent({ name: 'BUYER-01', role: 'buyer', budget: 6000, mode: 'auto', maxPrice: 45, qty: 100, brain: mockBrain });
  o.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
  const { deal, transcript } = await o.run({ maxRounds: 20, minRounds: 3 });
  assert.equal(deal, null);
  assert.ok(transcript.some((e) => e.type === 'unsigned'));
  assert.equal(o.ledger.available('BUYER-01'), 6000, 'el escrow vuelve al comprador');
  assert.equal(o.ledger.available('SELLER-02'), 0);
});

test('negociación: walk away saca al agente sin castigarlo', async () => {
  const quits = (agent, view) => view.round < 2
    ? { text: 'ofrezco $42', action: { type: 'offer', price: 42, qty: 100 } }
    : { text: 'esto es de mala fe, me voy', action: { type: 'walk_away' }, reason: 'spam de ofertas absurdas' };
  const o = new Negotiation({ notary });
  o.addAgent({ name: 'BUYER-01', role: 'buyer', budget: 6000, mode: 'auto', maxPrice: 45, qty: 100, brain: quits });
  o.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
  const { deal, transcript } = await o.run({ maxRounds: 20, minRounds: 5 });
  assert.equal(deal, null);
  assert.ok(transcript.some((e) => e.type === 'walk_away' && e.agent === 'BUYER-01'));
  assert.equal(o.guardian.strikes.get('BUYER-01') ?? 0, 0, 'irse no es una violación');
  assert.equal(o.ledger.available('BUYER-01'), 6000, 'se lleva su plata');
});

test('negociación: cada mensaje deja su razón en el acta (explicabilidad)', async () => {
  const o = new Negotiation({ notary });
  o.addAgent({ name: 'BUYER-01', role: 'buyer', budget: 6000, mode: 'auto', maxPrice: 45, qty: 100, brain: mockBrain });
  o.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
  const { transcript } = await o.run({ maxRounds: 20, minRounds: 3 });
  const msgs = transcript.filter((e) => e.type === 'message');
  assert.ok(msgs.length > 0);
  assert.ok(msgs.every((m) => typeof m.reason === 'string' && m.reason.length > 0), 'todo mensaje justifica su acción');
});

test('negociación: el trato se registra antes de mover la plata', async () => {
  let saldoAlRegistrar = null;
  const o = new Negotiation({
    notary,
    record: async () => { saldoAlRegistrar = o.ledger.available('SELLER-02'); return true; },
  });
  o.addAgent({ name: 'BUYER-01', role: 'buyer', budget: 6000, mode: 'auto', maxPrice: 45, qty: 100, brain: mockBrain });
  o.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
  const { deal } = await o.run({ maxRounds: 20, minRounds: 3 });
  assert.ok(deal);
  assert.equal(saldoAlRegistrar, 0, 'primero queda el registro, después se paga');
  assert.equal(o.ledger.available('SELLER-02'), deal.total);
});

test('negociación: un trato ya registrado no se paga dos veces', async () => {
  const o = new Negotiation({ notary, record: async () => false });
  o.addAgent({ name: 'BUYER-01', role: 'buyer', budget: 6000, mode: 'auto', maxPrice: 45, qty: 100, brain: mockBrain });
  o.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
  const { deal, transcript } = await o.run({ maxRounds: 20, minRounds: 3 });
  assert.equal(deal, null);
  assert.ok(transcript.some((e) => e.type === 'duplicate'));
  assert.equal(o.ledger.available('SELLER-02'), 0, 'nadie cobró dos veces');
  assert.equal(o.ledger.available('BUYER-01'), 6000, 'el escrow volvió');
});

test('negociación: el libro de cada mesa empieza de cero', async () => {
  const mesa = async () => {
    const n = new Negotiation({ notary });
    n.addAgent({ name: 'BUYER-01', role: 'buyer', budget: 6000, mode: 'auto', maxPrice: 45, qty: 100, brain: mockBrain });
    n.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
    const { transcript } = await n.run({ maxRounds: 20, minRounds: 3 });
    return transcript.find((e) => e.action?.type === 'accept').action.offerId;
  };
  assert.equal(await mesa(), await mesa(), 'dos mesas iguales dan el mismo libro: el contador no es global');
});
