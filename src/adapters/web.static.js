// Sirve la SPA de Angular ya compilada. Lo que no sea un archivo cae en
// index.html y lo resuelve el router del front.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

export function serveWeb(dir) {
  const root = resolve(dir);
  return (req, res) => {
    let path;
    try { path = normalize(decodeURIComponent(req.url.split('?')[0])); }
    catch { path = '/'; }
    // Sin este chequeo, /../../etc/passwd se sirve tan campante.
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(root, 'index.html');
    }
    if (!existsSync(file)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('el front no está compilado: cd web && npm install && npm run build');
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  };
}
