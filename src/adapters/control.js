// Quién puede mandar en el mercado.
//
// Arrancar y detener la arena es ruido; aprobar una compra no. Sin esto,
// cualquiera que abra la página pública puede contestar una autorización que
// no es suya, y la autorización es justo el control que no puede quedar
// abierto.
//
// Sin CONTROL_TOKEN los controles quedan abiertos, que es lo que uno quiere en
// local. Con token, la pantalla de operación entra por /arena?t=EL_TOKEN.
import { timingSafeEqual } from 'node:crypto';
import { secret } from './secrets.js';

const iguales = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

export const MANDOS = new Set(['arena_start', 'arena_stop', 'exploit_demo', 'approval']);

export function controlGate(token = secret('CONTROL_TOKEN')) {
  return {
    exige: Boolean(token),
    permite(msg) {
      if (!MANDOS.has(msg?.type)) return true; // el resto del protocolo no es un mando
      if (!token) return true;                // en local, abierto a propósito
      return iguales(msg?.token, token);
    },
  };
}
