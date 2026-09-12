// La copia que se llevan las dos partes: qué se compró, a quién, a qué precio,
// quién firmó y dónde quedó anclado.
//
// Es un documento, no una pantalla de la app: se abre desde un correo o desde
// un hilo de Slack, se imprime y se archiva. Por eso va en papel claro aunque
// el resto del producto sea oscuro. Lo que sí lleva es la identidad de
// Mercadia, porque quien lo recibe tiene que saber de dónde salió.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plata = (n) => '$' + Number(n ?? 0).toLocaleString('es-CO');

const CUSTODIA = {
  casa: 'llave de la casa',
  propia: 'llave propia · autocustodia',
  mercado: 'llave en custodia del mercado',
};

export function renderContract({ sheet, anchor, quotes = [], buyerOwner, sellerOwner, custody = {}, base = '' }) {
  const fecha = new Date(sheet.closedAt ?? Date.now()).toLocaleString('es-CO', {
    dateStyle: 'long', timeStyle: 'short',
  });

  const firmas = Object.entries(sheet.signatures ?? {}).map(([n, s]) => `
    <div class="firma">
      <div class="quien">${esc(n)}</div>
      <code>${esc(String(s).slice(0, 42))}…</code>
      <div class="custodia">${esc(CUSTODIA[custody[n]] ?? CUSTODIA.mercado)}</div>
    </div>`).join('');

  const competencia = quotes.length > 1 ? `
    <h2>Por qué este proveedor</h2>
    <p class="nota">Se pidió cotización a ${quotes.length} proveedores al mismo tiempo. Estas fueron sus respuestas.</p>
    <div class="marco">
      <table>
        <thead><tr><th>Proveedor</th><th class="num">Precio unidad</th><th class="num">Entrega</th><th>Resultado</th></tr></thead>
        <tbody>
          ${quotes.map((q) => `
            <tr${q.seller === sheet.seller ? ' class="gana"' : ''}>
              <td>${esc(q.owner ?? q.seller)}</td>
              <td class="num">${plata(q.price)}</td>
              <td class="num">${esc(q.leadDays)} días</td>
              <td>${q.seller === sheet.seller ? '<b>adjudicada</b>' : esc(q.reason ?? '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  return `<!doctype html><html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contrato · ${esc(sheet.item ?? 'compra')} · ${esc(sheet.seller)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bitter:wght@500;700&family=IBM+Plex+Mono:wght@400;600&family=Source+Sans+3:wght@400;600&display=swap">
<style>
  :root {
    --paper: #f7f5f0; --paper-2: #efebe3; --rule: #d8d2c6;
    --ink: #1a1c20; --ink-2: #4c4842; --ink-3: #7c766d;
    --sello: #b2402f; --verde: #2c6b4f;
    --display: "Bitter", Georgia, serif;
    --body: "Source Sans 3", -apple-system, "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--paper); color: var(--ink); font-family: var(--body);
    font-size: 16px; line-height: 1.6; margin: 0;
    padding-inline: 20px; padding-block: 0 64px;
  }
  .hoja { max-width: 720px; margin-inline: auto; }

  header {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 20px; flex-wrap: wrap;
    padding-block: 40px 16px; border-bottom: 2px solid var(--ink);
  }
  .marca {
    font-family: var(--display); font-weight: 700; font-size: 1.5rem;
    letter-spacing: .14em; margin: 0; color: var(--sello);
  }
  .marca small {
    display: block; font-family: var(--mono); font-size: .6rem; font-weight: 400;
    letter-spacing: .18em; color: var(--ink-3); margin-top: 4px; text-transform: uppercase;
  }
  .sello {
    font-family: var(--mono); font-size: .62rem; font-weight: 600;
    letter-spacing: .12em; text-transform: uppercase; color: var(--verde);
    border: 2px solid var(--verde); border-radius: 3px; padding: 7px 11px;
    rotate: -3deg; white-space: nowrap;
  }

  h1 { font-family: var(--display); font-size: 1.6rem; margin: 28px 0 4px; text-wrap: balance; }
  .ref { font-family: var(--mono); font-size: .72rem; color: var(--ink-3); margin: 0 0 4px; word-break: break-all; }

  h2 {
    font-family: var(--mono); font-size: .64rem; font-weight: 600;
    letter-spacing: .18em; text-transform: uppercase; color: var(--sello);
    margin: 34px 0 10px; padding-bottom: 7px; border-bottom: 1px solid var(--rule);
  }
  p { margin: 0 0 12px; }
  p.nota { font-size: .88rem; color: var(--ink-2); }

  .partes { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  @media (max-width: 560px) { .partes { grid-template-columns: 1fr; } }
  .parte { border-left: 3px solid var(--rule); padding-left: 12px; }
  .rol {
    font-family: var(--mono); font-size: .6rem; letter-spacing: .14em;
    text-transform: uppercase; color: var(--ink-3); display: block; margin-bottom: 2px;
  }
  .nombre { font-weight: 600; }
  .parte code, .firma code { font-family: var(--mono); font-size: .68rem; color: var(--ink-3); word-break: break-all; }

  .objeto {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(115px, 1fr));
    border: 1px solid var(--rule); border-radius: 4px; background: var(--paper-2); overflow: hidden;
  }
  .objeto > div { padding: 13px 15px; border-right: 1px solid var(--rule); }
  .objeto > div:last-child { border-right: 0; }
  .campo {
    display: block; font-family: var(--mono); font-size: .58rem; font-weight: 600;
    letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 3px;
  }
  .dato { font-family: var(--display); font-size: 1.15rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .dato.total { color: var(--sello); }

  .marco { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th {
    font-family: var(--mono); font-size: .58rem; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-3); text-align: left;
    padding: 0 10px 7px 0; border-bottom: 1px solid var(--ink); white-space: nowrap;
  }
  td { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.gana td { background: rgba(44, 107, 79, .07); color: var(--verde); }

  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 560px) { .firmas { grid-template-columns: 1fr; } }
  .firma { border: 1px solid var(--rule); border-radius: 4px; padding: 12px 14px; }
  .firma .quien { font-family: var(--mono); font-size: .78rem; font-weight: 600; margin-bottom: 5px; }
  .firma .custodia { font-size: .72rem; color: var(--ink-3); margin-top: 5px; }

  .acta { margin-top: 30px; padding: 15px 17px; border: 1px solid var(--rule); border-radius: 4px; background: var(--paper-2); }
  .acta p { font-size: .8rem; color: var(--ink-2); margin: 0 0 7px; }
  .acta code { font-family: var(--mono); font-size: .68rem; word-break: break-all; color: var(--ink); }
  .acta a { color: var(--sello); }

  footer {
    margin-top: 34px; padding-top: 14px; border-top: 1px solid var(--rule);
    font-family: var(--mono); font-size: .64rem; letter-spacing: .06em; color: var(--ink-3);
    display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  }
  footer a { color: var(--sello); text-decoration: none; }

  @media print {
    body { padding-block: 0; }
    .sello { rotate: none; }
    footer a { color: var(--ink-3); }
  }
</style></head><body>
<div class="hoja">

  <header>
    <p class="marca">MERCADIA<small>Acta de compraventa entre agentes</small></p>
    <div class="sello">Firmado<br>por las dos partes</div>
  </header>

  <h1>${esc(sheet.qty)} × ${esc(sheet.item ?? 'compra')}</h1>
  <p class="ref">${esc(sheet.id)} · ${esc(fecha)}</p>

  <h2>Partes</h2>
  <div class="partes">
    <div class="parte">
      <span class="rol">Comprador</span>
      <span class="nombre">${esc(buyerOwner ?? sheet.buyer)}</span><br>
      <code>${esc(sheet.buyer)}</code>
    </div>
    <div class="parte">
      <span class="rol">Proveedor</span>
      <span class="nombre">${esc(sellerOwner ?? sheet.seller)}</span><br>
      <code>${esc(sheet.seller)}</code>
    </div>
  </div>

  <h2>Objeto</h2>
  <div class="objeto">
    <div><span class="campo">Cantidad</span><span class="dato">${esc(sheet.qty)}</span></div>
    <div><span class="campo">Precio unidad</span><span class="dato">${plata(sheet.price)}</span></div>
    <div><span class="campo">Total</span><span class="dato total">${plata(sheet.total)}</span></div>
    <div><span class="campo">Entrega</span><span class="dato">${esc(sheet.leadDays ?? '—')} días</span></div>
  </div>
  ${competencia}

  <h2>Firmas</h2>
  <p class="nota">Firma EIP-191 sobre la forma canónica del acta. Sin las dos, el mercado no mueve un peso.</p>
  <div class="firmas">${firmas}</div>

  <div class="acta">
    <p><b>Acta de la negociación</b></p>
    <p><code>${esc(sheet.chainHead)}</code></p>
    <p>${anchor?.explorer
      ? `Anclada en Base Sepolia: <a href="${esc(anchor.explorer)}">ver la transacción</a>`
      : `Hash calculado; el anclaje en cadena queda pendiente${anchor?.error ? ` (${esc(String(anchor.error).split('\n')[0])})` : ''}`}.
      Cada mensaje de la negociación encadena el hash del anterior, así que cualquiera puede
      comprobar después que la conversación no se alteró, sin necesidad de leerla.</p>
  </div>

  <footer>
    <span>Mercadia · generado automáticamente al cerrar el trato</span>
    ${base ? `<a href="${esc(base)}">Ir al mercado</a>` : ''}
  </footer>

</div>
</body></html>`;
}
