// ¿Está listo para correr? Un comando, sin arrancar nada.
//   npm run estado
import { existsSync } from 'node:fs';

const hay = (v) => Boolean(process.env[v]?.trim());
const marca = (ok, texto, nota) => `  ${ok ? '✓' : '·'} ${texto.padEnd(26)} ${ok ? '' : nota}`;

const modelo = hay('OPENAI_API_KEY') ? 'OpenAI' : hay('OPENROUTER_API_KEY') ? 'OpenRouter' : null;
const slack = hay('SLACK_APP_TOKEN') && hay('SLACK_BOT_TOKEN');
const front = existsSync(new URL('../web/dist/web/browser/index.html', import.meta.url));
const wallets = existsSync(process.env.WALLETS_FILE ?? new URL('../wallets.json', import.meta.url).pathname);

console.log('\nMercadia · estado\n');
console.log('  LO QUE DEFINE LA ENTREGA');
console.log(marca(Boolean(modelo), `cerebro (${modelo ?? 'determinista'})`, 'sin OPENAI_API_KEY ni OPENROUTER_API_KEY'));
console.log(marca(slack, 'slack (comprador)', 'faltan SLACK_APP_TOKEN y SLACK_BOT_TOKEN'));
console.log(marca(hay('TELEGRAM_BOT_TOKEN'), 'telegram (proveedores)', 'falta TELEGRAM_BOT_TOKEN'));
console.log('\n  SUMAN PUNTOS, NO BLOQUEAN');
console.log(marca(hay('EXA_API_KEY'), 'exa (descubrimiento)', 'falta EXA_API_KEY'));
console.log(marca(hay('AMBIGUOUS_API_KEY'), 'ambiguous (registro)', 'falta AMBIGUOUS_API_KEY'));
console.log(marca(hay('MAIL_API_KEY'), 'correo', 'sin MAIL_API_KEY el enlace sale en pantalla'));
console.log(marca(wallets, 'wallets.json', 'corre: npm run wallets'));
console.log(marca(front, 'front compilado', 'corre: npm --prefix web install && npm --prefix web run build'));

const faltan = [!modelo && 'el cerebro', !slack && 'Slack', !hay('TELEGRAM_BOT_TOKEN') && 'Telegram'].filter(Boolean);
console.log(faltan.length
  ? `\n  Falta ${faltan.join(', ')}. Sin eso la demo completa no existe,\n  pero la compra desde la web sí corre: npm run dev\n`
  : '\n  Los tres canales están. Demo completa disponible.\n  Recuerda: cada proveedor le manda /start al bot antes de empezar.\n');
