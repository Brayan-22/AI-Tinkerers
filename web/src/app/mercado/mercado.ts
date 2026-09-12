import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Market } from '../market';
import { Mapa } from './mapa';
import { Topbar } from '../topbar';

// Lo que se puede pedir de una, para que la demo no arranque escribiendo.
const SUGERIDOS = ['botellas de agua', 'café', 'cajas de cartón'];
const plata = (n: number | null | undefined) => '$' + Number(n ?? 0).toLocaleString('es-CO');
const dias = (n: number | null | undefined) => (Number(n) === 1 ? '1 día' : `${n ?? '—'} días`);

// La compra en cuatro pasos, en el orden en que pasan: qué necesitas, quién
// lo vende, abre la compra y mira la negociación. Los estilos compartidos
// (tablas, feed, píldoras, botones) viven en styles.css.
@Component({
  selector: 'app-mercado',
  imports: [Mapa, Topbar],
  template: `
    <div class="page">
      <app-topbar />

      <section class="hero">
        <p class="eyebrow">Compra por cotización · <b>en vivo</b></p>
        <h1 class="display">Pide una vez. El agente cotiza con todos, descarta con razones y cierra con dos firmas.</h1>
        <p class="sub">Escribe qué necesitas. Los proveedores del mapa cotizan en paralelo y un guardián determinista decide si se mueve la plata.</p>
      </section>

      <section class="paso">
        <div class="paso-head"><p class="eyebrow"><span class="n">01</span> · qué necesitas</p></div>
        <div class="buscar">
          <input placeholder="botellas de agua, café, cajas de cartón…" aria-label="qué quieres comprar"
                 [value]="item()" (input)="item.set($any($event.target).value)" (keyup.enter)="buscar()">
          <button class="primary" (click)="buscar()">buscar proveedores</button>
        </div>
        <div class="chips">
          @for (s of sugeridos; track s) { <button class="chip" [class.on]="s === item()" (click)="elegir(s)">{{ s }}</button> }
        </div>
      </section>

      <section class="mapa">
        <app-mapa [agents]="market.catalog()" [destacados]="encontrados()" [ganador]="market.award()?.seller ?? null" />
        <p class="leyenda eyebrow"><span class="punto azul"></span> catálogo <span class="punto oro"></span> cotizan <span class="punto verde"></span> adjudicado</p>
      </section>

      @if (market.found().length) {
        <section class="paso">
          <div class="paso-head">
            <p class="eyebrow"><span class="n">02</span> · quién lo vende</p>
            <span class="pill info">{{ market.found().length }} proveedores de “{{ item() }}”</span>
          </div>
          <div class="card marco">
            <table class="tabla">
              <tr><th>proveedor</th><th>dónde</th><th class="num">desde</th><th class="num">entrega</th><th class="num">tratos</th></tr>
              @for (p of market.found(); track p.seller) {
                <tr>
                  <td>{{ p.owner }} <span class="origen {{ p.source ?? 'demo' }}">{{ origen(p.source) }}</span><small>{{ p.seller }}</small></td>
                  <td>{{ p.city ?? '—' }} @if (p.country) { · {{ p.country }} }</td>
                  <td class="num">{{ plata(p.minPrice) }}</td>
                  <td class="num">{{ dias(p.leadDays) }}</td>
                  <td class="num">{{ p.deals }} @if (p.violations) { <span class="bad">· {{ p.violations }} faltas</span> }</td>
                </tr>
              }
            </table>
          </div>
        </section>

        <section class="paso">
          <div class="paso-head"><p class="eyebrow"><span class="n">03</span> · abre la compra</p></div>
          <div class="card form">
            <label>cantidad <input type="number" min="1" [value]="qty()" (input)="qty.set(+$any($event.target).value)"></label>
            <label>precio máximo por unidad <input type="number" min="1" [value]="maxPrice()" (input)="maxPrice.set(+$any($event.target).value)"></label>
            <label>entrega máxima (días) <input type="number" min="1" [value]="maxLeadDays()" (input)="maxLeadDays.set(+$any($event.target).value)"></label>
            <label>tu nombre <input placeholder="Comprador" [value]="owner()" (input)="owner.set($any($event.target).value)"></label>
            <label>tu correo <input type="email" placeholder="para mandarte el contrato" [value]="email()" (input)="email.set($any($event.target).value)"></label>
            <label class="check"><input type="checkbox" [checked]="authorize()" (change)="authorize.set($any($event.target).checked)"> pedirme autorización antes de cerrar</label>
            <button class="primary lg go" [disabled]="market.comprando()" (click)="comprar()">
              @if (market.comprando()) { <span class="dot pulse"></span> negociando… } @else { que mi agente negocie }
            </button>
            @if (error()) { <p class="bad go">{{ error() }}</p> }
          </div>
        </section>
      }

      @if (market.rfqId()) {
        <section class="paso">
          <div class="paso-head">
            <p class="eyebrow"><span class="n">04</span> · la negociación en vivo</p>
            @if (market.comprando()) { <span class="pill warn"><span class="dot pulse"></span> cotizando con {{ market.enMesa() }} proveedores</span> }
            @else if (market.contrato()) { <span class="pill ok">contrato firmado</span> }
            @else { <span class="pill bad">sin trato</span> }
          </div>

          <div class="vivo">
            <div class="col">
              @if (market.award(); as g) {
                <div class="aviso ok ganador">
                  <p class="eyebrow ok">adjudicado</p>
                  <p class="quien display">{{ g.seller }}</p>
                  <p class="cifra num">{{ plata(g.price) }} × {{ market.demanda()?.qty }} = <b>{{ plata(g.total) }}</b> · entrega en {{ dias(g.leadDays) }}</p>
                </div>
              }

              <div class="card marco">
                <table class="tabla">
                  <tr><th>proveedor</th><th class="num">precio unidad</th><th class="num">entrega</th><th>estado</th></tr>
                  @for (q of ordenadas(); track q.seller) {
                    <tr [class.gana]="q.seller === market.award()?.seller">
                      <td>{{ q.owner ?? q.seller }}</td>
                      <td class="num">{{ plata(q.price) }}</td>
                      <td class="num">{{ dias(q.leadDays) }}</td>
                      <td>@if (q.seller === market.award()?.seller) { <span class="pill ok">adjudicada</span> } @else { <span class="pill">cotizó</span> }</td>
                    </tr>
                  }
                  @for (q of market.rejected(); track q.seller) {
                    <tr class="fuera">
                      <td class="tachado">{{ q.owner ?? q.seller }}</td>
                      <td class="num tachado">{{ plata(q.price) }}</td>
                      <td class="num tachado">{{ dias(q.leadDays) }}</td>
                      <td><span class="pill bad">descartada</span> <span class="razon">{{ q.reason }}</span></td>
                    </tr>
                  }
                  @if (!ordenadas().length && !market.rejected().length) {
                    <tr><td colspan="4" class="empty">esperando las primeras cotizaciones…</td></tr>
                  }
                </table>
              </div>

              @if (market.correo(); as c) {
                <div class="aviso">
                  <p>Tu agente espera autorización @if (c.to) { de <b>{{ c.to }}</b> }. <span class="muted">{{ c.note }}</span></p>
                  @if (c.link) {
                    <div class="acciones">
                      <a class="btn primary" [href]="c.link" target="_blank" rel="noopener">autorizar</a>
                      <a class="btn danger" [href]="c.rejectLink" target="_blank" rel="noopener">rechazar</a>
                    </div>
                  }
                </div>
              }

              @if (market.contrato(); as k) {
                <div class="aviso ok">
                  <p>Contrato firmado por las dos partes con <b>{{ k.seller }}</b>. @if (!k.funded) { <span class="muted">Compra de demostración: el comprador no depositó fondos.</span> }</p>
                  <div class="acciones"><a class="btn primary" [href]="k.url" target="_blank" rel="noopener">ver el contrato</a></div>
                </div>
              }
            </div>

            <div class="feed" #feed>
              @for (l of market.lines(); track $index) {
                <div class="msg {{ l.cls }}">
                  <div class="who">{{ l.who }}</div>
                  <div class="bub">@if (l.href) { <a [href]="l.href" target="_blank" rel="noopener">{{ l.text }}</a> } @else { {{ l.text }} }</div>
                  @if (l.reason) { <div class="why">porque: {{ l.reason }}</div> }
                </div>
              }
              @if (!market.lines().length) { <p class="empty">aquí aparece cada mensaje de la mesa, con la razón de cada movida</p> }
            </div>
          </div>
        </section>
      }

      <footer class="pie eyebrow"><span>Mercadia · AI Tinkerers Bogotá</span><span>mercadia.space</span></footer>
    </div>
  `,
  styles: `
    .hero { padding: 26px 0 6px; max-width: 920px; }
    .hero h1 { font-size: clamp(1.6rem, 3.2vw, 2.5rem); margin: 8px 0 12px; }
    .hero .sub { color: var(--text2); font-size: 1.05rem; max-width: 64ch; }
    .buscar { display: flex; gap: 10px; }
    .buscar input { flex: 1; font-size: 1.1rem; min-height: 52px; }
    .buscar button { min-height: 52px; white-space: nowrap; }
    @media (max-width: 700px) { .buscar { flex-direction: column; } }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .mapa { margin-top: 22px; }
    .leyenda { display: flex; align-items: center; gap: 8px 6px; margin-top: 8px; flex-wrap: wrap; }
    .punto { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-left: 10px; }
    .punto.azul { background: var(--blue); } .punto.oro { background: var(--gold); } .punto.verde { background: var(--green); }
    .form { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 18px; }
    @media (max-width: 700px) { .form { grid-template-columns: 1fr; } }
    .form .check, .form .go { grid-column: 1 / -1; }
    .form .go { width: 100%; }
    .vivo { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 18px; align-items: start; }
    @media (max-width: 900px) { .vivo { grid-template-columns: 1fr; } }
    .col { display: grid; gap: 14px; }
    .feed { max-height: 70vh; min-height: 320px; }
    .ganador .quien { font-size: 1.6rem; color: var(--green); }
    .ganador .cifra { font-size: 1rem; color: var(--text2); }
    .ganador .cifra b { color: var(--paper); }
    .razon { color: var(--mute); font-size: .85rem; margin-left: 6px; }
    .origen { display: inline-block; font-family: var(--mono); font-size: .62rem; letter-spacing: .08em;
      text-transform: uppercase; padding: 1px 6px; border-radius: 3px; border: 1px solid currentColor; vertical-align: 1px; }
    .origen.telegram { color: var(--green); } .origen.exa { color: var(--blue); } .origen.demo { color: var(--mute); }
  `,
})
export class Mercado {
  readonly market = inject(Market);
  readonly sugeridos = SUGERIDOS;
  readonly plata = plata;
  readonly dias = dias;
  readonly item = signal('botellas de agua');
  readonly qty = signal(200);
  readonly maxPrice = signal(60);
  readonly maxLeadDays = signal(7);
  readonly owner = signal('');
  readonly email = signal('');
  readonly authorize = signal(false);
  readonly error = signal('');
  private feed = viewChild<ElementRef<HTMLDivElement>>('feed');

  readonly encontrados = computed(() => new Set(this.market.found().map((f) => f.seller)));
  readonly ordenadas = computed(() => {
    const fuera = new Set(this.market.rejected().map((q) => q.seller));
    return [...this.market.quotes()].filter((q) => !fuera.has(q.seller)).sort((a, b) => a.price - b.price);
  });

  constructor() {
    this.market.connect();
    this.market.cargarCatalogo();
    // El último mensaje siempre a la vista: en una demo nadie hace scroll.
    effect(() => {
      this.market.lines();
      const el = this.feed()?.nativeElement;
      if (el) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }

  // De dónde sale cada proveedor. Lo que no es una persona real lo dice.
  origen(source?: string | null) {
    if (source === 'telegram') return 'persona real';
    if (source === 'exa') return 'hallado en la web · simulado';
    return 'utilería';
  }

  buscar() { this.market.buscar(this.item()); }
  elegir(s: string) { this.item.set(s); this.buscar(); }

  async comprar() {
    this.error.set('');
    const r = await this.market.comprar({
      item: this.item(), qty: this.qty(), maxPrice: this.maxPrice(), maxLeadDays: this.maxLeadDays(),
      owner: this.owner() || 'Comprador', email: this.email(), authorize: this.authorize(),
    });
    if (r.error) this.error.set(r.error);
  }
}
