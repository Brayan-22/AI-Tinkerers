import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityOf, pricesIn, toListings, reference, descubrir } from '../src/adapters/discovery.exa.js';

const RESULTADOS = [
  { title: 'Hidro Andina | Agua embotellada al por mayor', url: 'https://hidroandina.co', summary: 'Empresa de Bogotá que vende botellas de agua desde $1.200 la unidad, entrega en 2 días.' },
  { title: 'Aguas del Valle - distribuidor', url: 'https://aguasvalle.co', summary: 'Distribuidora en Cali, precio mayorista $1.100 por botella.' },
  { title: 'Pacific Water', url: 'https://pacificwater.pe', summary: 'Planta en Lima, exporta agua a $950 COP la unidad.' },
  { title: 'Blog: cómo elegir agua', url: 'https://blog.example.com', summary: 'Nota general sin ubicación ni precios.' },
  { title: 'Hidro Andina | otra página', url: 'https://hidroandina.co/precios', summary: 'Bogotá, lista de precios.' },
];

test('exa: reconoce la ciudad en el texto', () => {
  assert.equal(cityOf('empresa de Bogotá D.C.').city, 'Bogotá');
  assert.equal(cityOf('planta en LIMA, Perú').country, 'PE');
  assert.equal(cityOf('no dice dónde queda'), null);
});

test('exa: saca precios con punto de miles y con moneda', () => {
  assert.deepEqual(pricesIn('desde $1.200 la unidad'), [1200]);
  assert.deepEqual(pricesIn('cuesta 950 COP'), [950]);
  assert.deepEqual(pricesIn('entre $1.100 y $1.500'), [1100, 1500]);
  assert.deepEqual(pricesIn('sin precios acá'), []);
});

test('exa: solo entran los proveedores con ubicación, y una vez cada uno', () => {
  const l = toListings(RESULTADOS, 'botellas de agua');
  assert.equal(l.length, 3, 'el blog sin ciudad queda fuera y la empresa repetida no se duplica');
  assert.deepEqual(l.map((x) => x.city), ['Bogotá', 'Cali', 'Lima']);
  assert.equal(l[0].minPrice, 1200);
  assert.equal(l[0].leadDays, null, 'el plazo no se inventa: se le pregunta');
  assert.equal(l[0].source, 'exa');
});

test('exa: la referencia de mercado viene con sus fuentes', () => {
  const r = reference(RESULTADOS);
  assert.equal(r.median, 1100, "mediana de 950, 1100 y 1200");
  assert.equal(r.sources.length, 3);
  assert.ok(r.sources[0].url.startsWith('https://'));
});

test('exa: con menos de tres precios no hay referencia, y se dice', () => {
  const r = reference([RESULTADOS[0]]);
  assert.equal(r.median, null, 'un solo precio no es un mercado');
  assert.equal(r.sources.length, 1);
});

test('exa: sin llave no toca la red y lo avisa', async () => {
  const r = await descubrir({ item: 'agua', key: null });
  assert.equal(r.sinLlave, true);
  assert.deepEqual(r.suppliers, []);
});
