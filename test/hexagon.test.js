import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

// El hexágono solo se sostiene si algo lo verifica. En JS no hay compilador
// que lo haga: esto es el compilador.
test('hexágono: el dominio no importa infraestructura', async () => {
  const dir = new URL('../src/market/', import.meta.url);
  for (const file of await readdir(dir)) {
    const src = await readFile(new URL(file, dir), 'utf8');
    for (const [, spec] of src.matchAll(/\bfrom\s+'([^']+)'/g)) {
      const own = spec.startsWith('./') && !spec.includes('..');
      assert.ok(
        spec.startsWith('node:') || own,
        `${file} importa "${spec}" — el dominio solo puede importar node: o archivos de src/market/`,
      );
    }
  }
});
