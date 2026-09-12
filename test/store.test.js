import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/adapters/store.sqlite.js';

const deal = { id: 'd1', buyer: 'B', seller: 'S', price: 42, qty: 100, total: 4200, sheet: { chainHead: '0xab', signatures: {} } };

test('store: el mismo trato no se liquida dos veces (idempotencia)', () => {
  const s = openStore(':memory:');
  assert.equal(s.saveDeal(deal), true, 'primera vez: liquida');
  assert.equal(s.saveDeal(deal), false, 'reintento: no liquida');
  assert.deepEqual(s.closedPrices(), [42]);
});

test('store: la historia de precios sobrevive al reinicio', () => {
  const s = openStore(':memory:');
  s.saveDeal(deal);
  s.saveDeal({ ...deal, id: 'd2', price: 44 });
  assert.deepEqual(s.closedPrices(), [42, 44]);
});

test('store: la reputación cuenta tratos y violaciones por agente', () => {
  const s = openStore(':memory:');
  s.saveDeal(deal);
  s.recordViolation('S');
  const rep = Object.fromEntries(s.reputation().map((r) => [r.name, r]));
  assert.equal(rep.B.deals, 1);
  assert.equal(rep.S.deals, 1);
  assert.equal(rep.S.violations, 1);
});

test('store: el saldo del agente sobrevive a la sesión', () => {
  const s = openStore(':memory:');
  assert.equal(s.balance('EXT-1'), null, 'agente nuevo: sin saldo previo');
  s.setBalance('EXT-1', 1200);
  assert.equal(s.balance('EXT-1'), 1200);
  s.setBalance('EXT-1', 300);
  assert.equal(s.balance('EXT-1'), 300, 'lo que perdió no se recupera reconectando');
});

test('store: un depósito se acredita una sola vez', () => {
  const s = openStore(':memory:');
  const dep = { txHash: '0xAA', logIndex: 0, from: '0xF00', amount: 5000 };
  assert.equal(s.recordDeposit(dep), true);
  assert.equal(s.recordDeposit(dep), false, 'el mismo log no entra dos veces');
  s.setAddress('EXT-1', '0xf00');
  assert.equal(s.settleDeposits(), 5000);
  assert.equal(s.balance('EXT-1'), 5000);
  assert.equal(s.settleDeposits(), 0, 'no se acredita de nuevo');
});

test('store: el depósito que llegó antes del registro se acredita al registrarse', () => {
  const s = openStore(':memory:');
  s.recordDeposit({ txHash: '0xBB', logIndex: 1, from: '0xBEEF', amount: 200 });
  assert.equal(s.settleDeposits(), 0, 'nadie reclamó esa dirección todavía');
  s.setAddress('EXT-2', '0xbeef');
  assert.equal(s.settleDeposits(), 200);
  assert.equal(s.balance('EXT-2'), 200);
});

test('store: el bloque escaneado se recuerda entre reinicios', () => {
  const s = openStore(':memory:');
  assert.equal(s.lastBlock(), 0);
  s.setLastBlock(12345);
  assert.equal(s.lastBlock(), 12345);
});

test('store: el catálogo dice quién vende qué y dónde está', () => {
  const s = openStore(':memory:');
  s.recordAgent('AGUA-BOG', 'Distribuidora Bogotá');
  s.placeAgent('AGUA-BOG', { lat: 4.71, lon: -74.07, city: 'Bogotá', country: 'CO' });
  s.listSupply('AGUA-BOG', { item: 'botellas de agua', leadDays: 2, minPrice: 40 });
  s.listSupply('AGUA-BOG', { item: 'botellas de agua', leadDays: 1, minPrice: 38 }); // upsert

  const [row] = s.search('agua');
  assert.equal(row.seller, 'AGUA-BOG');
  assert.equal(row.city, 'Bogotá');
  assert.equal(row.leadDays, 1, 'la publicación se actualiza, no se duplica');
  assert.equal(s.search('tornillos').length, 0);
  assert.equal(s.catalog().length, 1);
});

test('store: los comparables son por producto, no del mercado entero', () => {
  const s = openStore(':memory:');
  const trato = (id, item, price) => ({ id, buyer: 'B', seller: 'S', price, qty: 1, total: price, sheet: { item, chainHead: '0x', signatures: {} } });
  s.saveDeal(trato('d1', 'agua', 40));
  s.saveDeal(trato('d2', 'agua', 42));
  s.saveDeal(trato('d3', 'café', 900));
  assert.deepEqual(s.closedPrices(50, 'agua'), [40, 42]);
  assert.deepEqual(s.closedPrices(50, 'café'), [900]);
  assert.equal(s.closedPrices().length, 3);
});

test('store: el contrato se guarda y se recupera entero', () => {
  const s = openStore(':memory:');
  s.saveContract('c1', '<h1>contrato</h1>', { item: 'agua', price: 42 });
  assert.equal(s.contract('c1').sheet.price, 42);
  assert.equal(s.contract('nope'), null);
});
