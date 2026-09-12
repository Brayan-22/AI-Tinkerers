import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { secret } from '../src/adapters/secrets.js';

test('secretos: el archivo gana sobre la variable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mercadia-'));
  const file = join(dir, 'clave');
  writeFileSync(file, 'del-archivo\n');
  process.env.PRUEBA_SECRETO = 'de-la-variable';
  process.env.PRUEBA_SECRETO_FILE = file;
  assert.equal(secret('PRUEBA_SECRETO'), 'del-archivo', 'y se le quita el salto de línea');

  delete process.env.PRUEBA_SECRETO_FILE;
  assert.equal(secret('PRUEBA_SECRETO'), 'de-la-variable');

  delete process.env.PRUEBA_SECRETO;
  assert.equal(secret('PRUEBA_SECRETO', 'por-defecto'), 'por-defecto');
});

test('secretos: un archivo que no existe no rompe nada', () => {
  process.env.FALTANTE_FILE = '/no/existe/clave';
  process.env.FALTANTE = 'de-la-variable';
  assert.equal(secret('FALTANTE'), 'de-la-variable');
  delete process.env.FALTANTE_FILE;
  delete process.env.FALTANTE;
});

test('secretos: una variable vacía cuenta como ausente', () => {
  process.env.VACIA = '';
  assert.equal(secret('VACIA', 'respaldo'), 'respaldo', 'X= en .env no debe ganarle al respaldo');
  process.env.VACIA = '   ';
  assert.equal(secret('VACIA', 'respaldo'), 'respaldo', 'solo espacios tampoco cuenta');
  process.env.VACIA = '  real  ';
  assert.equal(secret('VACIA'), 'real', 'y el valor de verdad viene recortado');
  delete process.env.VACIA;
});

import { env } from '../src/adapters/secrets.js';

test('valores: una variable vacía no le gana al valor por defecto', () => {
  process.env.URL_X = '';
  assert.equal(env('URL_X', 'http://localhost:3000'), 'http://localhost:3000', 'PUBLIC_URL= vacío rompía los enlaces');
  process.env.URL_X = 'https://mercadia.space';
  assert.equal(env('URL_X', 'http://localhost:3000'), 'https://mercadia.space');
  delete process.env.URL_X;
  assert.equal(env('URL_X', 3000), 3000, 'y el defecto puede no ser texto');
});
