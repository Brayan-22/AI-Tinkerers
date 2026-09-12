import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteAgents } from '../src/adapters/brain.remote.js';

const socket = () => ({ sent: [], send(raw) { this.sent.push(JSON.parse(raw)); } });

test('agentes externos: solo el socket que entró con ese nombre puede contestar por él', async () => {
  const hub = remoteAgents({ turnMs: 100 });
  const mine = socket();
  const impostor = socket();
  hub.join('EXT-1', mine, '0x'.padEnd(42, '1'));

  const turn = hub.brain('EXT-1')({ name: 'EXT-1' }, { round: 1 });
  assert.equal(hub.deliver('your_turn', 'EXT-1', { text: 'soy yo', action: { type: 'talk' } }, impostor), false);
  assert.equal(hub.deliver('your_turn', 'EXT-1', { text: 'hola', action: { type: 'talk' } }, mine), true);
  assert.equal((await turn).text, 'hola');
});

test('agentes externos: el que no contesta a tiempo pasa el turno, no congela el mercado', async () => {
  const hub = remoteAgents({ turnMs: 50 });
  hub.join('EXT-2', socket());
  const answer = await hub.brain('EXT-2')({ name: 'EXT-2' }, { round: 1 });
  assert.equal(answer.action.type, 'talk');
  assert.match(answer.reason, /no contestó/);
});

test('agentes externos: al cerrar el socket deja de responder por ese nombre', async () => {
  const hub = remoteAgents({ turnMs: 50 });
  const ws = socket();
  hub.join('EXT-3', ws);
  hub.leave(ws);
  assert.equal(hub.has('EXT-3'), false);
  assert.equal(await hub.sign('EXT-3', 'acta'), null);
});

test('agentes externos: el hub sabe qué nombre entró por cada socket', () => {
  const hub = remoteAgents();
  const ws = socket();
  hub.join('EXT-9', ws, '0x'.padEnd(42, '9'));
  assert.equal(hub.nameOf(ws), 'EXT-9');
  assert.equal(hub.nameOf(socket()), undefined, 'un socket ajeno no es nadie');
  hub.leave(ws);
  assert.equal(hub.nameOf(ws), undefined);
});
