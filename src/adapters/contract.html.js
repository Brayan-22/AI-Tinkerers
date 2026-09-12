// La copia que se llevan las dos partes: qué se compró, a quién, a qué precio,
// quién firmó y dónde quedó anclado. Un archivo, sin dependencias.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plata = (n) => '$' + Number(n ?? 0).toLocaleString('es-CO');

const CUSTODIA = { casa: 'llave de la casa', propia: 'llave propia', mercado: 'llave en custodia del mercado' };

export function renderContract({ sheet, anchor, quotes = [], buyerOwner, sellerOwner, custody = {} }) {
  const fecha = new Date(sheet.closedAt ?? Date.now()).toLocaleString('es-CO');
  const firmas = Object.entries(sheet.signatures ?? {})
    .map(([n, s]) => `<li><b>${esc(n)}</b> <code>${esc(String(s).slice(0, 34))}…</code>
        <small>${esc(CUSTODIA[custody[n]] ?? 'llave en custodia del mercado')}</small></li>`).join('');
  const competencia = quotes.length > 1
    ? `<h2>Cotizaciones recibidas</h2><table>
       <tr><th>Proveedor</th><th>Precio unidad</th><th>Entrega</th><th></th></tr>
       ${quotes.map((q) => `<tr${q.seller === sheet.seller ? ' class="gana"' : ''}>
          <td>${esc(q.seller)}</td><td>${plata(q.price)}</td><td>${esc(q.leadDays)} días</td>
          <td>${q.seller === sheet.seller ? 'adjudicada' : esc(q.reason ?? '')}</td></tr>`).join('')}
       </table>` : '';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Contrato ${esc(sheet.id)}</title>
<style>
 body{font-family:ui-monospace,monospace;max-width:760px;margin:40px auto;padding:0 20px;color:#111;line-height:1.5}
 h1{font-size:18px;letter-spacing:.12em}h2{font-size:12px;letter-spacing:.12em;margin-top:28px;color:#666}
 table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
 th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}
 th{font-size:11px;color:#666;font-weight:400}
 .gana{background:#f4f9f4;font-weight:700}
 code{font-size:11px;color:#666;word-break:break-all}
 ul{list-style:none;padding:0;font-size:13px}
 .sello{margin-top:28px;padding:12px;border:1px solid #ddd;font-size:11px;color:#666}
</style></head><body>
<h1>CONTRATO DE COMPRAVENTA</h1>
<p><code>${esc(sheet.id)}</code> · ${esc(fecha)}</p>

<h2>Partes</h2>
<table>
  <tr><th>Comprador</th><td>${esc(buyerOwner ?? sheet.buyer)} <code>${esc(sheet.buyer)}</code></td></tr>
  <tr><th>Vendedor</th><td>${esc(sellerOwner ?? sheet.seller)} <code>${esc(sheet.seller)}</code></td></tr>
</table>

<h2>Objeto</h2>
<table>
  <tr><th>Producto</th><th>Cantidad</th><th>Precio unidad</th><th>Total</th><th>Entrega</th></tr>
  <tr><td>${esc(sheet.item)}</td><td>${esc(sheet.qty)}</td><td>${plata(sheet.price)}</td>
      <td><b>${plata(sheet.total)}</b></td><td>${esc(sheet.leadDays)} días</td></tr>
</table>
${competencia}

<h2>Firmas</h2>
<ul>${firmas}</ul>

<div class="sello">
  Acta de la negociación: <code>${esc(sheet.chainHead)}</code><br>
  ${anchor?.explorer ? `Anclada en Base Sepolia: <a href="${esc(anchor.explorer)}">${esc(anchor.hash)}</a>`
    : `Hash calculado, anclaje pendiente${anchor?.error ? ` (${esc(anchor.error.split('\n')[0])})` : ''}`}<br>
  Cualquiera puede verificar que esta conversación no se alteró sin necesidad de leerla.
</div>
</body></html>`;
}
