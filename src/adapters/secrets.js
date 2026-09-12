// Docker Swarm entrega los secretos como archivos en /run/secrets, no como
// variables de entorno. Esto acepta las dos formas: VAR o VAR_FILE.
// Un secreto en una variable de entorno se ve en `docker inspect`; en un
// archivo, no. Por eso vale la pena la indirección.
import { readFileSync, existsSync } from 'node:fs';

// Una variable vacía es una variable que no está. Suena obvio, pero .env.example
// se reparte con todas las llaves en blanco, y sin esto un `X=` vacío gana
// sobre cualquier respaldo con `??`, porque la cadena vacía no es null.
export function secret(name, fallback = undefined) {
  const file = process.env[`${name}_FILE`];
  if (file && existsSync(file)) {
    try { return readFileSync(file, 'utf8').trim() || fallback; }
    catch { return fallback; }
  }
  return process.env[name]?.trim() || fallback;
}
