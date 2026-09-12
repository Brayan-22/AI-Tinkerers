// Las llaves de los agentes de la casa. Fuera del control de versiones.
// Si no están, el mercado corre igual pero nadie puede firmar un acta: los
// tratos no cierran. Es la degradación correcta, no un crash.
import { env } from './secrets.js';
import { readFileSync, existsSync, statSync } from 'node:fs';

// En swarm llega como secreto montado; en local es el archivo del repo.
const FILE = env('WALLETS_FILE', new URL('../../wallets.json', import.meta.url).pathname);

function load() {
  if (!existsSync(FILE) || !statSync(FILE).isFile()) return {};
  try {
    return Object.fromEntries(JSON.parse(readFileSync(FILE, 'utf8')).map((w) => [w.name, w]));
  } catch {
    console.warn('wallets.json ilegible — corre: npm run wallets');
    return {};
  }
}

export const wallets = load();
