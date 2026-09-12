import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanBrain } from '../src/adapters/brain.human.js';
import { Rfq } from '../src/market/rfq.js';
import { supplierBrain, askBrain } from '../src/adapters/brain.mock.js';

const notary = {
  async sign(name, msg) { return `sig:${name}:${msg.length}`; },
  async verify(name, msg, sig) { return sig === `sig:${name}:${msg.length}`; },
};

const canalFalso = (...respuestas) => {
  const cola = [...respuestas];
  return { dicho: [], async decir(c, t) { this.dicho.push(t); }, async esperar() { return cola.shift() ?? null; } };
};

test('humano: la respuesta de una persona se vuelve cotización estructurada', async () => {
  const canal = canalFalso('te la dejo en 1.200 y te la mando en 2 días');
  const brain = humanBrain(canal, '1', { qty: 200 });
  const r = await brain({ name: 'PROV', role: 'seller', qty: 200 }, { round: 1, item: 'botellas de agua' });
  assert.equal(r.action.type, 'quote');
  assert.equal(r.action.price, 1200);
  assert.equal(r.action.qty, 200);
  assert.equal(r.action.leadDays, 2);
  assert.match(canal.dicho[0], /200/, 'le dijo cuánto se necesita');
});

test('humano: si no contesta, pasa el turno y la mesa sigue', async () => {
  const brain = humanBrain(canalFalso(), '1', { qty: 100 });
  const r = await brain({ name: 'PROV', role: 'seller', qty: 100 }, { round: 1, item: 'agua' });
  assert.equal(r.action.type, 'talk');
  assert.match(r.reason, /no respondió/);
});

test('humano: si dice que no tiene, no se le inventa una cotización', async () => {
  const brain = humanBrain(canalFalso('uy no, eso está agotado'), '1', { qty: 100 });
  const r = await brain({ name: 'PROV', role: 'seller', qty: 100 }, { round: 1, item: 'agua' });
  assert.equal(r.action.type, 'talk');
  assert.match(r.reason, /no tiene/);
});

test('humano: cierra solo cuando le pagan lo que pidió, sin volver a preguntarle', async () => {
  const canal = canalFalso('$1.000 la unidad, en 2 días');
  const brain = humanBrain(canal, '1', { qty: 100 });
  await brain({ name: 'PROV', role: 'seller', qty: 100 }, { round: 1, item: 'agua' });
  const cierre = await brain({ name: 'PROV', role: 'seller', qty: 100 }, { round: 1, item: 'agua', bestOffer: { id: 'of-1', price: 1000, qty: 100 } });
  assert.equal(cierre.action.type, 'accept');
  assert.equal(cierre.action.offerId, 'of-1');
  assert.match(canal.dicho.at(-1), /Cerrado/);
});

test('humano: si le ofrecen menos de lo que pidió, se le pregunta y él decide', async () => {
  const canal = canalFalso('$1.000 la unidad en 2 días', 'no, muy bajo');
  const brain = humanBrain(canal, '1', { qty: 100 });
  await brain({ name: 'PROV', role: 'seller', qty: 100 }, { round: 1, item: 'agua' });
  const r = await brain({ name: 'PROV', role: 'seller', qty: 100 }, { round: 2, item: 'agua', bestOffer: { id: 'of-1', price: 800, qty: 100 } });
  assert.equal(r.action.type, 'talk');
  assert.match(canal.dicho.at(-1), /¿Lo tomas\?/);
});

test('rfq: una persona real compite contra un agente simulado y gana', async () => {
  const canal = canalFalso('$1.000 la unidad, entrego en 2 días');
  const persona = {
    name: 'PROV-JUAN', owner: 'Juan (celular)', role: 'seller', budget: 0,
    qty: 100, leadDays: 2, minPrice: 0, brain: humanBrain(canal, '1', { qty: 100 }),
  };
  const simulado = { name: 'SIMULADO', owner: 'Simulado', role: 'seller', budget: 0, qty: 100, leadDays: 3, minPrice: 1100, brain: supplierBrain };

  const rfq = new Rfq({
    demand: {
      buyer: 'TIENDA-01', owner: 'Tienda', item: 'botellas de agua', qty: 100,
      maxPrice: 2000, maxLeadDays: 5, budget: 500000, brain: askBrain,
    },
    suppliers: [persona, simulado], notary, rondas: 2,
  });

  const { deal, quotes } = await rfq.run();
  assert.equal(quotes.length, 2, 'cotizaron los dos');
  assert.ok(deal, 'el trato cerró');
  assert.equal(deal.seller, 'PROV-JUAN', 'gana la persona real por ser más barata y más rápida');
  assert.equal(deal.price, 1000);
  assert.equal(deal.sheet.leadDays, 2);
  assert.deepEqual(Object.keys(deal.sheet.signatures).sort(), ['PROV-JUAN', 'TIENDA-01']);
});
