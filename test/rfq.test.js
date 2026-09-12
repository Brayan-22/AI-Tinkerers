import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rfq, mejorCotizacion } from '../src/market/rfq.js';
import { askBrain, supplierBrain } from '../src/adapters/brain.mock.js';

const notary = {
  async sign(name, msg) { return `sig:${name}:${msg.length}`; },
  async verify(name, msg, sig) { return sig === `sig:${name}:${msg.length}`; },
};

const proveedor = (name, minPrice, leadDays) => ({
  name, owner: name, role: 'seller', budget: 0, minPrice, leadDays, qty: 1000, brain: supplierBrain,
});

const compra = (over = {}) => ({
  buyer: 'TIENDA-01', owner: 'Tienda Doña Marta', item: 'botellas de agua',
  qty: 100, maxPrice: 60, maxLeadDays: 7, budget: 9000, brain: askBrain, ...over,
});

test('rfq: elige la cotización más barata que cumple plazo y techo', () => {
  const quotes = [
    { seller: 'A', price: 50, leadDays: 3 },
    { seller: 'B', price: 44, leadDays: 2 },
    { seller: 'C', price: 46, leadDays: 1 },
  ];
  assert.equal(mejorCotizacion(quotes).seller, 'B');
});

test('rfq: a igual precio gana el que entrega más rápido', () => {
  const quotes = [{ seller: 'A', price: 44, leadDays: 5 }, { seller: 'B', price: 44, leadDays: 2 }];
  assert.equal(mejorCotizacion(quotes).seller, 'B');
});

test('rfq: pide cotización a todos los proveedores a la vez y cierra con uno', async () => {
  const eventos = [];
  const rfq = new Rfq({
    demand: compra(),
    suppliers: [proveedor('CARO', 55, 2), proveedor('BARATO', 40, 3), proveedor('MEDIO', 47, 1)],
    notary,
    onEvent: (e) => eventos.push(e),
  });
  const result = await rfq.run();

  assert.ok(result.deal, 'debe cerrar con alguien');
  assert.equal(result.deal.seller, 'BARATO', 'el más barato dentro del plazo');
  assert.equal(result.deal.sheet.item, 'botellas de agua');
  assert.equal(result.deal.sheet.leadDays, 3);
  assert.equal(result.quotes.length, 3, 'cotizaron los tres');
  assert.ok(eventos.some((e) => e.type === 'rfq_open'));
  assert.ok(eventos.some((e) => e.type === 'quote_received' && e.seller === 'CARO'));
  assert.ok(eventos.some((e) => e.type === 'awarded' && e.seller === 'BARATO'));
});

test('rfq: descarta al que no llega a tiempo aunque sea el más barato', async () => {
  const rfq = new Rfq({
    demand: compra({ maxLeadDays: 2 }),
    suppliers: [proveedor('LENTO-BARATO', 38, 9), proveedor('RAPIDO', 45, 1)],
    notary,
  });
  const { deal, descartadas } = await rfq.run();
  assert.equal(deal.seller, 'RAPIDO');
  assert.ok(descartadas.some((d) => d.seller === 'LENTO-BARATO' && /plazo/.test(d.reason)));
});

test('rfq: si nadie cumple el techo de precio, no hay trato', async () => {
  const eventos = [];
  const rfq = new Rfq({
    demand: compra({ maxPrice: 20 }),
    suppliers: [proveedor('A', 40, 1), proveedor('B', 45, 1)],
    notary,
    onEvent: (e) => eventos.push(e),
  });
  const { deal, descartadas } = await rfq.run();
  assert.equal(deal, null);
  assert.equal(descartadas.length, 2);
  assert.ok(eventos.some((e) => e.type === 'rfq_empty'));
});

test('rfq: el trato queda firmado por las dos partes y con el acta encadenada', async () => {
  const rfq = new Rfq({ demand: compra(), suppliers: [proveedor('UNICO', 42, 2)], notary });
  const { deal } = await rfq.run();
  assert.deepEqual(Object.keys(deal.sheet.signatures).sort(), ['TIENDA-01', 'UNICO']);
  assert.match(deal.sheet.chainHead, /^[0-9a-f]{64}$/);
});

test('rfq: el comprador puede exigir autorización humana antes de cerrar', async () => {
  const pedidas = [];
  const rfq = new Rfq({
    demand: compra({ mode: 'supervised' }),
    suppliers: [proveedor('UNICO', 42, 2)],
    notary,
    approve: async (req) => { pedidas.push(req); return { answer: 'no' }; },
  });
  const { deal } = await rfq.run();
  assert.equal(deal, null, 'sin autorización no hay contrato');
  assert.equal(pedidas.length, 1);
  assert.equal(pedidas[0].item, 'botellas de agua');
  assert.equal(pedidas[0].seller, 'UNICO');
});

test('rfq: sin techo ni plazo declarados, no se descarta a nadie por eso', async () => {
  const rfq = new Rfq({
    demand: { buyer: 'B', owner: 'B', item: 'computador', qty: 1, maxPrice: null, maxLeadDays: null, budget: 1e9, brain: askBrain },
    suppliers: [proveedor('CARO', 3900000, 30)],
    notary,
  });
  const { deal, descartadas } = await rfq.run();
  assert.equal(descartadas.length, 0, 'un límite que nadie puso no puede descartar');
  assert.ok(deal, 'y el trato cierra');
});
