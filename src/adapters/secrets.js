// Docker Swarm entrega los secretos como archivos en /run/secrets, no como
// variables de entorno. Esto acepta las dos formas: VAR o VAR_FILE.
// Un secreto en una variable de entorno se ve en `docker inspect`; en un
// archivo, no. Por eso vale la pena la indirección.
import { readFileSync, existsSync } from 'node:fs';

export function secret(name, fallback = undefined) {
  const file = process.env[`${name}_FILE`];
  if (file && existsSync(file)) {
    try { return readFileSync(file, 'utf8').trim() || fallback; }
    catch { return fallback; }
  }
  return process.env[name] ?? fallback;
}
