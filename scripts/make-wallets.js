// Genera las wallets de los agentes de la casa en Base Sepolia y las guarda en
// wallets.json (gitignored). Es aditivo: solo crea las que falten, nunca pisa
// una llave existente. Uso: node scripts/make-wallets.js
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const FILE = new URL('../wallets.json', import.meta.url).pathname;
const NAMES = ['MARKET-ESCROW', 'BUYER-01', 'SELLER-02', 'NAIVE-01', 'GREEDY-02'];

const existing = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
const have = new Set(existing.map((w) => w.name));
const added = NAMES.filter((n) => !have.has(n)).map((name) => {
  const privateKey = generatePrivateKey();
  return { name, address: privateKeyToAccount(privateKey).address, privateKey };
});

if (!added.length) {
  console.log('wallets.json ya tiene todas las llaves de la casa. Nada que hacer.');
  process.exit(0);
}

writeFileSync(FILE, JSON.stringify([...existing, ...added], null, 2));
console.log('llaves nuevas (las direcciones son públicas, seguras de compartir):\n');
for (const w of added) console.log(`  ${w.name.padEnd(14)} ${w.address}`);
