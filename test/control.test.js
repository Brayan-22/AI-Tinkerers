import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlGate } from '../src/adapters/control.js';

test('control: sin token configurado, todo pasa (modo local)', () => {
  const g = controlGate(null);
  assert.equal(g.exige, false);
  assert.equal(g.permite({ type: 'arena_start' }), true);
  assert.equal(g.permite({ type: 'approval', answer: 'si' }), true);
});

test('control: con token, un mando sin el token correcto se cae', () => {
  const g = controlGate('s3creto');
  assert.equal(g.exige, true);
  assert.equal(g.permite({ type: 'approval', answer: 'si' }), false, 'nadie aprueba compras ajenas');
  assert.equal(g.permite({ type: 'approval', answer: 'si', token: 'otro' }), false);
  assert.equal(g.permite({ type: 'arena_start', token: 's3creto' }), true);
  assert.equal(g.permite({ type: 'approval', answer: 'si', token: 's3creto' }), true);
});

test('control: lo que no es un mando nunca se bloquea', () => {
  const g = controlGate('s3creto');
  for (const type of ['join', 'action', 'signature', 'listing', 'withdraw']) {
    assert.equal(g.permite({ type }), true, `${type} no es un mando`);
  }
});
