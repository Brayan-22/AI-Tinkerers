import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/market/ledger.js';
import { Guardian } from '../src/market/guardian.js';
import { Negotiation } from '../src/market/negotiation.js';
import { mockBrain } from '../src/adapters/brain.mock.js';

test('ledger: escrow y settle mueven fondos correctamente', () => {
  const l = new Ledger();
  l.open('A', 100);
  l.open('B', 0);
  l.commit('A', 40);
  assert.equal(l.available('A'), 60);
  l.settle('A', 'B', 40);
  assert.equal(l.available('B'), 40);
  assert.equal(l.escrowed('A'), 0);
});

test('ledger: no permite comprometer más de lo disponible', () => {
  const l = new Ledger();
  l.open('A', 10);
  assert.throws(() => l.commit('A', 11));
});

test('guardian: rechaza oferta sin fondos y expulsa a la segunda', () => {
  const l = new Ledger();
  l.open('ROGUE', 5);
  const g = new Guardian(l);
  const bad = { type: 'offer', price: 100, qty: 10 };
  assert.equal(g.check('ROGUE', bad).ok, false);
  g.strike('ROGUE');
  assert.equal(g.expelled('ROGUE'), false);
  g.strike('ROGUE');
  assert.equal(g.expelled('ROGUE'), true);
});

test('guardian: detecta suplantación de identidad', () => {
  const l = new Ledger();
  l.open('ROGUE', 5);
  const g = new Guardian(l);
  const r = g.check('ROGUE', { type: 'talk', as: 'BUYER-01' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /suplanta/);
});

test('guardian: detecta explotación — precio fuera del rango de mercado', () => {
  const l = new Ledger();
  const g = new Guardian(l, { history: [42, 43, 42] });
  const bad = g.reviewDeal({ buyer: 'NAIVE', seller: 'GREEDY', price: 55 });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /explota/i);
  assert.equal(g.reviewDeal({ buyer: 'B', seller: 'S', price: 44 }).ok, true);
  // sin historia suficiente no hay referencia: no bloquea
  const g2 = new Guardian(l, { history: [] });
  assert.equal(g2.reviewDeal({ buyer: 'B', seller: 'S', price: 99 }).ok, true);
});

test('orquestador: trato explotador se suspende y no se liquida', async () => {
  const history = [42, 43, 42];
  const o = new Negotiation({ history });
  o.addAgent({ name: 'NAIVE-01', role: 'buyer', budget: 9000, mode: 'auto', maxPrice: 70, qty: 100, naive: true, brain: mockBrain });
  o.addAgent({ name: 'GREEDY-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 55, qty: 100, greedy: true, brain: mockBrain });
  const result = await o.run({ maxRounds: 20, minRounds: 2 });
  assert.equal(result.deal, null, 'el guardián debe frenar el trato abusivo');
  assert.ok(result.transcript.some((e) => e.type === 'exploitation_alert'));
  assert.equal(o.ledger.available('GREEDY-02'), 0);
});

test('orquestador: dos agentes mock cierran trato y se liquida', async () => {
  const o = new Negotiation();
  o.addAgent({ name: 'BUYER-01', role: 'buyer', budget: 6000, mode: 'auto', maxPrice: 45, qty: 100, brain: mockBrain });
  o.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
  const result = await o.run({ maxRounds: 20, minRounds: 3 });
  assert.ok(result.deal, 'debe cerrar trato');
  assert.ok(result.deal.price >= 41 && result.deal.price <= 45);
  assert.equal(o.ledger.available('SELLER-02'), result.deal.price * result.deal.qty);
  assert.ok(result.rounds >= 3, 'fricción: mínimo de rondas');
});

test('orquestador: el tramposo sin fondos es expulsado y no roba', async () => {
  const o = new Negotiation();
  o.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
  o.addAgent({ name: 'ROGUE-03', role: 'buyer', budget: 5, mode: 'auto', maxPrice: 99, qty: 100, brain: mockBrain, cheat: true });
  const result = await o.run({ maxRounds: 20, minRounds: 1 });
  assert.equal(result.deal, null);
  assert.ok(o.guardian.expelled('ROGUE-03'), 'el tramposo debe salir expulsado');
  assert.equal(o.ledger.available('SELLER-02'), 0, 'nadie recibió plata fantasma');
});

test('modo supervisado: el humano aprueba con sí/no/otro', async () => {
  const decisions = [];
  const o = new Negotiation({
    approve: async (req) => { decisions.push(req); return { answer: 'si' }; },
  });
  o.addAgent({ name: 'BUYER-01', role: 'buyer', budget: 6000, mode: 'supervised', maxPrice: 45, qty: 100, brain: mockBrain });
  o.addAgent({ name: 'SELLER-02', role: 'seller', budget: 0, mode: 'auto', minPrice: 41, qty: 100, brain: mockBrain });
  const result = await o.run({ maxRounds: 20, minRounds: 3 });
  assert.ok(result.deal, 'con aprobación humana el trato cierra');
  assert.equal(decisions.length, 1, 'se pidió aprobación exactamente al cerrar');
  assert.equal(decisions[0].agent, 'BUYER-01');
});
