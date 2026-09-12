// Descubrimiento con Exa. Dos usos, ninguno decorativo:
//
// 1. Proveedores de verdad. El catálogo sembrado se reemplaza por empresas que
//    existen, con su ciudad y su sitio.
// 2. Referencia de precio de mercado. El guardián necesita comparables para
//    decir si a alguien lo están esquilmando, y hoy solo los tiene después de
//    tres tratos cerrados. Con Exa los tiene en el primero, citando la fuente.
import { secret } from './secrets.js';

const EXA = 'https://api.exa.ai/search';

// Geocodificación de pobre: una tabla, no una API. Para un mapa de ciudades
// alcanza, y no mete otra llave ni otra latencia.
const CIUDADES = {
  'bogot': [4.711, -74.072, 'Bogotá', 'CO'], 'medell': [6.244, -75.581, 'Medellín', 'CO'],
  'cali': [3.452, -76.532, 'Cali', 'CO'], 'barranquilla': [10.968, -74.781, 'Barranquilla', 'CO'],
  'cartagena': [10.391, -75.479, 'Cartagena', 'CO'], 'bucaramanga': [7.119, -73.122, 'Bucaramanga', 'CO'],
  'pereira': [4.813, -75.696, 'Pereira', 'CO'], 'armenia': [4.533, -75.681, 'Armenia', 'CO'],
  'lima': [-12.046, -77.043, 'Lima', 'PE'], 'quito': [-0.181, -78.467, 'Quito', 'EC'],
  'guayaquil': [-2.17, -79.922, 'Guayaquil', 'EC'], 'santiago': [-33.449, -70.669, 'Santiago', 'CL'],
  'buenos aires': [-34.604, -58.382, 'Buenos Aires', 'AR'], 'montevideo': [-34.902, -56.164, 'Montevideo', 'UY'],
  'são paulo': [-23.551, -46.633, 'São Paulo', 'BR'], 'sao paulo': [-23.551, -46.633, 'São Paulo', 'BR'],
  'ciudad de m': [19.433, -99.133, 'Ciudad de México', 'MX'], 'guadalajara': [20.677, -103.347, 'Guadalajara', 'MX'],
  'monterrey': [25.687, -100.316, 'Monterrey', 'MX'], 'panam': [8.984, -79.518, 'Panamá', 'PA'],
  'madrid': [40.417, -3.704, 'Madrid', 'ES'], 'miami': [25.761, -80.191, 'Miami', 'US'],
};

export function cityOf(texto) {
  const t = String(texto ?? '').toLowerCase();
  for (const [clave, [lat, lon, city, country]] of Object.entries(CIUDADES)) {
    if (t.includes(clave)) return { lat, lon, city, country };
  }
  return null;
}

// Números que parecen precios. El formato colombiano usa punto de miles, así
// que primero se quitan los separadores de miles y después se parsea.
export function pricesIn(texto) {
  const t = String(texto ?? '');
  const crudos = [...t.matchAll(/\$\s?([\d.,]+)/g), ...t.matchAll(/([\d.,]+)\s*(?:cop|pesos|usd|mxn)/gi)];
  return crudos
    .map((m) => Number(m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 1e9);
}

const nombre = (r) => String(r.title ?? r.url ?? '')
  .split(/[|·\-–—]/)[0].replace(/\s+/g, ' ').trim().slice(0, 40) || 'Proveedor';

const sigla = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\W+/g, '-').toUpperCase().slice(0, 16).replace(/^-|-$/g, '') || 'EXA';

// Un resultado de Exa se vuelve candidato a proveedor solo si sabemos dónde
// está. Sin ubicación no va al mapa y no sirve para comparar plazos.
export function toListings(resultados, item) {
  const vistos = new Set();
  const salida = [];
  for (const r of resultados ?? []) {
    const texto = `${r.title ?? ''} ${r.summary ?? ''} ${r.text ?? ''}`;
    const donde = cityOf(texto);
    if (!donde) continue;
    const seller = `EXA-${sigla(nombre(r))}`;
    if (vistos.has(seller)) continue;
    vistos.add(seller);
    const precios = pricesIn(texto);
    salida.push({
      seller, owner: nombre(r), item, url: r.url ?? null,
      ...donde,
      minPrice: precios.length ? Math.min(...precios) : null,
      leadDays: null, // no se inventa: se le pregunta al proveedor
      source: 'exa',
    });
  }
  return salida;
}

// La referencia de mercado, con sus fuentes a la vista. Es un indicio citado,
// no una verdad: si sale mal, el humano ve de dónde salió y lo descarta.
export function reference(resultados) {
  const precios = [];
  const fuentes = [];
  for (const r of resultados ?? []) {
    const encontrados = pricesIn(`${r.title ?? ''} ${r.summary ?? ''} ${r.text ?? ''}`);
    if (!encontrados.length) continue;
    precios.push(...encontrados);
    fuentes.push({ title: nombre(r), url: r.url ?? null, prices: encontrados.slice(0, 3) });
  }
  if (precios.length < 3) return { median: null, prices: precios, sources: fuentes };
  const ordenados = [...precios].sort((a, b) => a - b);
  return { median: ordenados[Math.floor(ordenados.length / 2)], prices: ordenados, sources: fuentes };
}

export function exaKey() { return secret('EXA_API_KEY') ?? null; }

export async function buscarEnLaWeb({ item, place = 'Colombia', limit = 8, key = exaKey() } = {}) {
  if (!key) return { results: [], sinLlave: true };
  const res = await fetch(EXA, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `proveedores mayoristas de ${item} en ${place}: precio al por mayor y tiempo de entrega`,
      numResults: limit, type: 'auto',
      contents: {
        text: { maxCharacters: 800 },
        summary: { query: 'nombre de la empresa, ciudad donde opera, qué vende, precio al por mayor y plazo de entrega si aparecen' },
      },
    }),
  });
  if (!res.ok) return { results: [], error: `exa ${res.status}` };
  const data = await res.json();
  return { results: data?.results ?? [] };
}

// Lo que usa el mercado: una llamada, dos respuestas.
export async function descubrir({ item, place, key = exaKey() } = {}) {
  const { results, sinLlave, error } = await buscarEnLaWeb({ item, place, key });
  return { suppliers: toListings(results, item), market: reference(results), sinLlave, error };
}
