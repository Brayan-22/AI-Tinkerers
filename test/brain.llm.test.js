import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAction, llmBrain } from '../src/adapters/brain.llm.js';

const fallback = () => ({ text: 'respaldo', reason: 'el modelo no sirvió', action: { type: 'talk' } });

test('llm: lee el JSON aunque venga con cercos de código', () => {
  const r = parseAction('```json\n{"text":"te doy $40","reason":"mi techo es 45","action":{"type":"offer","price":40,"qty":100}}\n```');
  assert.equal(r.action.type, 'offer');
  assert.equal(r.action.price, 40);
  assert.equal(r.text, 'te doy $40');
});

test('llm: lee el JSON aunque el modelo agregue cháchara alrededor', () => {
  const r = parseAction('Claro, aquí va: {"text":"$44","reason":"cierro","action":{"type":"accept","offerId":"of-3"}} listo');
  assert.equal(r.action.offerId, 'of-3');
});

test('llm: una acción que no existe se descarta', () => {
  assert.equal(parseAction('{"text":"x","action":{"type":"robar","price":1}}'), null);
  assert.equal(parseAction('esto no es json'), null);
  assert.equal(parseAction(''), null);
});

test('llm: sin llave usa el cerebro determinista, sin tocar la red', async () => {
  const brain = llmBrain(fallback, { key: null });
  assert.equal(brain, fallback);
});

test('llm: si el modelo se pasa del techo, manda el determinista', async () => {
  const brain = llmBrain(fallback, { key: 'x', model: 'm' });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"text":"te doy $999","reason":"gano","action":{"type":"offer","price":999,"qty":100}}' } }] }) });
  const r = await brain({ name: 'B', role: 'buyer', qty: 100, maxPrice: 45 }, { round: 1 });
  assert.equal(r.text, 'respaldo', 'el mandato lo impone el código, no el modelo');
});

test('llm: si el modelo se cae, la mesa sigue', async () => {
  const brain = llmBrain(fallback, { key: 'x' });
  globalThis.fetch = async () => { throw new Error('503'); };
  const r = await brain({ name: 'B', role: 'buyer', qty: 100, maxPrice: 45 }, { round: 1 });
  assert.equal(r.action.type, 'talk');
});

test('llm: completa cantidad y plazo si el modelo los olvida', async () => {
  const brain = llmBrain(fallback, { key: 'x' });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"text":"$44 la unidad","reason":"piso 41","action":{"type":"quote","price":44}}' } }] }) });
  const r = await brain({ name: 'S', role: 'seller', qty: 250, minPrice: 41, leadDays: 3 }, { round: 1 });
  assert.equal(r.action.qty, 250);
  assert.equal(r.action.leadDays, 3);
});

import { pedidoPorReglas } from '../src/adapters/brain.llm.js';

test('pedido: entiende cantidad, techo y plazo escritos como los escribe alguien', () => {
  const jueves = new Date('2026-09-12T12:00:00Z'); // viernes
  const p = pedidoPorReglas('necesito 200 botellas de agua para el viernes, máximo $1.500 c/u', jueves);
  assert.equal(p.qty, 200);
  assert.equal(p.maxPrice, 1500);
  assert.equal(p.maxLeadDays, 1, 'de jueves a viernes es un día');
  assert.match(p.item, /botellas de agua/);
});

test('pedido: "urgente" y "en 3 días" mandan sobre el default', () => {
  assert.equal(pedidoPorReglas('50 cajas de cartón urgente').maxLeadDays, 1);
  assert.equal(pedidoPorReglas('consígueme 80 kilos de café en 3 días').maxLeadDays, 3);
  assert.equal(pedidoPorReglas('quiero 80 kilos de café en 3 días').qty, 80);
});

test('pedido: sin techo de precio lo deja en null y no lo inventa', () => {
  const p = pedidoPorReglas('necesito 300 botellas de agua');
  assert.equal(p.maxPrice, null);
  assert.equal(p.maxLeadDays, 7, 'default explícito');
});

import { cotizacionPorReglas } from '../src/adapters/brain.llm.js';

test('cotización: entiende cómo contesta una persona de verdad', () => {
  const jueves = new Date('2026-09-12T12:00:00Z');
  const a = cotizacionPorReglas('te la dejo en 1.200 la unidad y te la mando el viernes', jueves);
  assert.equal(a.price, 1200);
  assert.equal(a.leadDays, 1);

  const b = cotizacionPorReglas('$950 c/u, entrego en 3 días', jueves);
  assert.equal(b.price, 950);
  assert.equal(b.leadDays, 3);

  const c = cotizacionPorReglas('vale 1500 pesos, mañana mismo', jueves);
  assert.equal(c.price, 1500);
  assert.equal(c.leadDays, 1);
});

test('cotización: reconoce cuando el proveedor dice que no', () => {
  assert.equal(cotizacionPorReglas('no tengo en este momento').rechaza, true);
  assert.equal(cotizacionPorReglas('eso está agotado, perdón').rechaza, true);
  assert.equal(cotizacionPorReglas('no manejo ese producto').price, null);
});

test('cotización: sin plazo no lo inventa', () => {
  const r = cotizacionPorReglas('son $1.100 la unidad');
  assert.equal(r.price, 1100);
  assert.equal(r.leadDays, null, 'si no dijo cuándo, no se asume');
});
