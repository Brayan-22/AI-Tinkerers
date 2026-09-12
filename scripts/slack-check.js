// ¿Sirven los tokens de Slack? Un comando, sin arrancar el mercado.
//
//   npm run slack:check                valida los dos tokens y el socket mode
//   npm run slack:check -- C012ABCDE   además publica un mensaje de prueba en ese canal
//
// Lo único que no se puede verificar por API es que la Interactividad esté
// encendida. Sin ella los botones de Autorizar/Rechazar no responden. Con el
// manifiesto (deploy/slack-app-manifest.yml) ya viene encendida.
import { secret } from '../src/adapters/secrets.js';

const API = 'https://slack.com/api';
const NECESARIOS = ['app_mentions:read', 'chat:write', 'im:history', 'users:read', 'users:read.email'];
const app = secret('SLACK_APP_TOKEN');
const bot = secret('SLACK_BOT_TOKEN');
const canal = process.argv[2];

let fallas = 0;
const bien = (texto) => console.log(`  ✓ ${texto}`);
const mal = (texto, arreglo) => { fallas++; console.log(`  ✗ ${texto}\n      → ${arreglo}`); };

const llamar = async (token, metodo, body = {}) => {
  try {
    const res = await fetch(`${API}/${metodo}`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    // Slack devuelve los scopes del token en una cabecera; sirve para saber
    // qué falta sin adivinar.
    return { ...(await res.json()), scopes: res.headers.get('x-oauth-scopes') ?? '' };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'timeout' : e.message, scopes: '' };
  }
};

console.log('\nMercadia · Slack\n');

// Cada token se prueba por su lado: así se puede validar el primero que
// llegue sin esperar al otro.
if (!bot) mal('SLACK_BOT_TOKEN vacío', 'Install App → Install to Workspace → copia el Bot User OAuth Token (xoxb-…) al .env');
if (!app) mal('SLACK_APP_TOKEN vacío', 'Basic Information → App-Level Tokens → Generate con connections:write → copia el xapp-… al .env');
if (!bot && !app) {
  console.log('\n  Sin tokens no hay nada que probar. La app se crea con deploy/slack-app-manifest.yml.\n');
  process.exit(1);
}

// 1. Bot token: quién soy y en qué workspace.
const yo = bot ? await llamar(bot, 'auth.test') : { ok: false };
if (bot && !yo.ok) mal(`bot token rechazado (${yo.error})`, 'reinstala la app (Install App) y copia el token nuevo; un token revocado o de otra app da invalid_auth');
if (yo.ok) bien(`bot token: @${yo.user} en el workspace ${yo.team}`);

// 2. Scopes: los que usa el adaptador.
if (yo.ok) {
  const tengo = new Set(yo.scopes.split(',').map((s) => s.trim()).filter(Boolean));
  const faltan = NECESARIOS.filter((s) => !tengo.has(s));
  if (faltan.length) mal(`faltan scopes: ${faltan.join(', ')}`, 'OAuth & Permissions → Bot Token Scopes: agrégalos y vuelve a instalar la app');
  else bien(`scopes: ${NECESARIOS.join(' · ')}`);
}

// 3. App token: pedir la URL del socket es exactamente lo que hace el adaptador al arrancar.
if (app) {
  const socket = await llamar(app, 'apps.connections.open');
  if (!socket.ok) mal(`socket mode no abre (${socket.error})`, 'el xapp- necesita el scope connections:write y Socket Mode encendido en la app');
  else bien('socket mode: Slack entregó la URL de conexión');
}

// 4. Opcional: un mensaje al canal, para confirmar chat:write y que el bot está adentro.
if (canal && yo.ok) {
  const r = await llamar(bot, 'chat.postMessage', {
    channel: canal,
    text: 'Mercadia está conectado. Pídeme algo mencionándome: `@Mercadia necesito 200 botellas de agua para el viernes, máximo $1.500`',
  });
  if (r.ok) bien(`mensaje de prueba publicado en ${canal}`);
  else if (r.error === 'not_in_channel') mal(`el bot no está en ${canal}`, `en ese canal escribe: /invite @${yo.user}`);
  else if (r.error === 'channel_not_found') mal(`no existe el canal ${canal}`, 'pasa el ID del canal (empieza por C…), no el nombre: está al final de los detalles del canal');
  else mal(`no pude publicar en ${canal} (${r.error})`, 'revisa el scope chat:write y que el token sea el de esta app');
}

console.log(fallas
  ? `\n  ${fallas} cosa${fallas > 1 ? 's' : ''} por arreglar antes de arrancar.\n`
  : `\n  Slack está listo. Falta lo que no se ve por API: Interactividad encendida y /invite @${yo.user ?? 'Mercadia'} en el canal.\n  Arranca con npm run dev y menciona al bot con un pedido.\n`);
process.exit(fallas ? 1 : 0);
