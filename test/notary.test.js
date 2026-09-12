import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walletNotary, signedBy } from '../src/adapters/signer.wallet.js';
import { wallets } from '../src/adapters/wallets.js';

// La compuerta que decide si se mueve plata. Un verify() que siempre diga que
// sí no lo cacha ningún test del dominio: los casos negativos van acá.
test('notario: la firma vale para un acta y para una sola', async (t) => {
  if (!wallets['BUYER-01'] || !wallets['SELLER-02']) return t.skip('sin wallets.json — corre npm run wallets');
  const notary = walletNotary();
  const sig = await notary.sign('BUYER-01', 'acta A');

  assert.equal(await notary.verify('BUYER-01', 'acta A', sig), true);
  assert.equal(await notary.verify('BUYER-01', 'acta B', sig), false, 'no se reusa en otra acta');
  assert.equal(await notary.verify('SELLER-02', 'acta A', sig), false, 'la firma de uno no vale por el otro');
  assert.equal(await notary.verify('BUYER-01', 'acta A', '0xdeadbeef'), false, 'basura no pasa');
  assert.equal(await notary.sign('DESCONOCIDO', 'acta A'), null, 'sin llave no se firma');
});

test('notario: probar una dirección es firmar un reto con su llave', async (t) => {
  if (!wallets['BUYER-01'] || !wallets['SELLER-02']) return t.skip('sin wallets.json');
  const notary = walletNotary();
  const reto = 'mercadia/auth/1|EXT-1|nonce-123';
  const sig = await notary.sign('BUYER-01', reto);

  assert.equal(await signedBy(wallets['BUYER-01'].address, reto, sig), true);
  assert.equal(await signedBy(wallets['SELLER-02'].address, reto, sig), false, 'no vale la firma de otro');
  assert.equal(await signedBy(wallets['BUYER-01'].address, 'otro reto', sig), false, 'no se reusa el reto');
  assert.equal(await signedBy(wallets['BUYER-01'].address, reto, undefined), false);
});

test('notario: al que no trae llave, el mercado le guarda una', async () => {
  const guardadas = new Map();
  const custodia = {
    keyOf: (n) => guardadas.get(n) ?? null,
    setKey: (n, privateKey, address) => guardadas.set(n, { privateKey, address }),
  };
  const notary = walletNotary(null, custodia);

  assert.equal(notary.custodyOf('COMPRA-WEB'), 'mercado');
  const sig = await notary.sign('COMPRA-WEB', 'acta A');
  assert.equal(await notary.verify('COMPRA-WEB', 'acta A', sig), true);
  assert.equal(await notary.verify('COMPRA-WEB', 'acta B', sig), false);

  const direccion = guardadas.get('COMPRA-WEB').address;
  await notary.sign('COMPRA-WEB', 'otra acta');
  assert.equal(guardadas.get('COMPRA-WEB').address, direccion, 'la llave no se regenera en cada firma');
});

test('notario: el que probó su dirección firma él, no el mercado', async () => {
  const custodia = { keyOf: () => null, setKey: () => { throw new Error('no debería guardar llave ajena'); } };
  const remoto = { addressOf: (n) => (n === 'EXT-1' ? '0x'.padEnd(42, '1') : undefined), sign: async () => '0xfirma-del-agente' };
  const notary = walletNotary(remoto, custodia);
  assert.equal(notary.custodyOf('EXT-1'), 'propia');
  assert.equal(await notary.sign('EXT-1', 'acta'), '0xfirma-del-agente');
});
