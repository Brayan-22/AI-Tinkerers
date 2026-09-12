// ¿Está listo para correr? Un comando, sin arrancar nada.
//   npm run estado
import { existsSync } from 'node:fs';

const hay = (v) => Boolean(process.env[v]?.trim());
const marca = (ok, texto, nota) => `  ${ok ? '✓' : '·'} ${texto.padEnd(26)} ${ok ? '' : nota}`;

const modelo = hay('OPENAI_API_KEY') ? 'OpenAI' : hay('OPENROUTER_API_KEY') ? 'OpenRouter' : null;
// El CLI de Ambiguous deja la llave en su propio archivo, no en el entorno.
const ambiguous = hay('AMBIGUOUS_API_KEY') || existsSync(new URL('../.ambi/config.json', import.meta.url));
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
console.log(marca(ambiguous, 'ambiguous (registro)', 'corre: npx ambiguous auth signup'));
const remitente = process.env.MAIL_FROM?.trim() ?? '';
const remitenteOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(remitente);
console.log(marca(hay('MAIL_API_KEY') && remitenteOk, 'correo',
  !hay('MAIL_API_KEY') ? 'sin MAIL_API_KEY el enlace sale en pantalla'
    : `MAIL_FROM no es una dirección: "${remitente}"`));
console.log(marca(wallets, 'wallets.json', 'corre: npm run wallets'));
console.log(marca(front, 'front compilado', 'corre: npm --prefix web install && npm --prefix web run build'));

const faltan = [!modelo && 'el cerebro', !slack && 'Slack', !hay('TELEGRAM_BOT_TOKEN') && 'Telegram'].filter(Boolean);
console.log(faltan.length
  ? `\n  Falta ${faltan.join(', ')}. Sin eso la demo completa no existe,\n  pero la compra desde la web sí corre: npm run dev\n`
  : '\n  Los tres canales están. Demo completa disponible.\n  Recuerda: cada proveedor le manda /start al bot antes de empezar.\n');
