// Imprime las herramientas que expone el servidor MCP de Ambiguous y cuáles
// de nuestros espejos encontraron pareja. Es "la llamada tonta" del plan.
import { ambiguousChannel } from '../src/adapters/channel.ambiguous.js';

const a = ambiguousChannel();
const r = await a.conectar();
if (!r.ok) { console.error('no conectó:', r.error); process.exit(1); }
console.log(`${r.lista.length} herramientas. Espejos resueltos:`);
for (const [rol, nombre] of Object.entries(r.tools)) console.log(`  ${rol.padEnd(7)} → ${nombre ?? '(ninguna: ajustar PATRONES en channel.ambiguous.js)'}`);
console.log('\nTodas:');
for (const t of r.lista) console.log(`  ${t.name}  —  ${(t.description ?? '').slice(0, 80)}`);
