import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Market } from '../market';
import { Mapa } from './mapa';

@Component({
  selector: 'app-mercado',
  imports: [RouterLink, Mapa],
  template: `
    <header>
      <h1>MERCADIA</h1>
      <nav>
        <a routerLink="/arena">arena del guardián</a>
        <span [class.off]="!market.live()">● {{ market.live() ? 'conectado' : 'sin conexión' }}</span>
      </nav>
    </header>

    <section class="buscar">
      <input placeholder="qué quieres comprar (botellas de agua, café, cajas de cartón)"
             [value]="item()" (input)="item.set($any($event.target).value)" (keyup.enter)="buscar()">
      <button (click)="buscar()">buscar proveedores</button>
    </section>

    <app-mapa [agents]="market.catalog()" [destacados]="encontrados()" [ganador]="market.award()?.seller ?? null" />

    @if (market.found().length) {
      <h2>{{ market.found().length }} proveedores de "{{ item() }}"</h2>
      <table>
        <tr><th>proveedor</th><th>dónde</th><th>desde</th><th>entrega</th><th>tratos</th></tr>
        @for (p of market.found(); track p.seller) {
          <tr>
            <td>{{ p.owner }} <small>{{ p.seller }}</small></td>
            <td>{{ p.city }}@if (p.country) { , {{ p.country }} }</td>
            <td>\${{ p.minPrice }}</td>
            <td>{{ p.leadDays }} días</td>
            <td>{{ p.deals }}@if (p.violations) { <span class="mal"> · {{ p.violations }} faltas</span> }</td>
          </tr>
        }
      </table>

      <h2>abre la compra</h2>
      <div class="form">
        <label>cantidad <input type="number" min="1" [value]="qty()" (input)="qty.set(+$any($event.target).value)"></label>
        <label>precio máximo por unidad <input type="number" min="1" [value]="maxPrice()" (input)="maxPrice.set(+$any($event.target).value)"></label>
        <label>entrega máxima (días) <input type="number" min="1" [value]="maxLeadDays()" (input)="maxLeadDays.set(+$any($event.target).value)"></label>
        <label>tu nombre <input [value]="owner()" (input)="owner.set($any($event.target).value)"></label>
        <label>tu correo <input type="email" [value]="email()" (input)="email.set($any($event.target).value)"></label>
        <label class="check">
          <input type="checkbox" [checked]="authorize()" (change)="authorize.set($any($event.target).checked)">
          pedirme autorización por correo antes de cerrar
        </label>
        <button class="go" [disabled]="market.comprando()" (click)="comprar()">
          {{ market.comprando() ? 'negociando…' : 'que mi agente negocie' }}
        </button>
        @if (error()) { <p class="mal">{{ error() }}</p> }
      </div>
    }

    @if (market.rfqId()) {
      <h2>cotizaciones</h2>
      <table>
        <tr><th>proveedor</th><th>precio unidad</th><th>entrega</th><th></th></tr>
        @for (q of ordenadas(); track q.seller) {
          <tr [class.gana]="q.seller === market.award()?.seller">
            <td>{{ q.owner ?? q.seller }}</td>
            <td>\${{ q.price }}</td>
            <td>{{ q.leadDays }} días</td>
            <td>{{ q.seller === market.award()?.seller ? 'adjudicada' : '' }}</td>
          </tr>
        }
        @for (q of market.rejected(); track q.seller) {
          <tr class="fuera"><td>{{ q.seller }}</td><td>\${{ q.price }}</td><td>{{ q.leadDays }} días</td><td>{{ q.reason }}</td></tr>
        }
      </table>

      @if (market.correo(); as c) {
        <div class="aviso">
          <p>Tu agente espera autorización@if (c.to) { de <b>{{ c.to }}</b> }. {{ c.note }}</p>
          @if (c.link) {
            <a class="go" [href]="c.link" target="_blank" rel="noopener">autorizar</a>
            <a class="no" [href]="c.rejectLink" target="_blank" rel="noopener">rechazar</a>
          }
        </div>
      }

      @if (market.contrato(); as k) {
        <div class="aviso ok">
          <p>Contrato firmado con <b>{{ k.seller }}</b>@if (!k.funded) { <small> · compra de demostración: el comprador no depositó</small> }</p>
          <a class="go" [href]="k.url" target="_blank" rel="noopener">ver el contrato</a>
        </div>
      }

      <h2>la negociación</h2>
      <div class="feed">
        @for (l of market.lines(); track $index) {
          <div class="msg {{ l.cls }}">
            <div class="who">{{ l.who }}</div>
            <div class="bub">
              @if (l.href) { <a [href]="l.href" target="_blank" rel="noopener">{{ l.text }}</a> } @else { {{ l.text }} }
            </div>
            @if (l.reason) { <div class="why">porque: {{ l.reason }}</div> }
          </div>
        }
      </div>
    }
  `,
  styles: `
    header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
    h1 { font-size: 16px; letter-spacing: .15em; color: var(--gold); }
    nav { display: flex; gap: 14px; font-size: 11px; color: var(--mute); }
    nav a { color: var(--blue); text-decoration: none; }
    nav span.off { color: var(--mute); }
    nav span { color: var(--green); }
    h2 { font-size: 10px; letter-spacing: .15em; color: var(--mute); margin: 24px 0 8px; text-transform: uppercase; }
    .buscar { display: flex; gap: 8px; margin-bottom: 14px; }
    .buscar input { flex: 1; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; font-size: 10px; color: var(--mute); font-weight: 400; padding: 4px 6px; }
    td { padding: 6px; border-top: 1px solid var(--line); }
    td small { color: var(--mute); font-size: 10px; }
    tr.gana td { color: var(--green); font-weight: 700; }
    tr.fuera td { color: var(--mute); text-decoration: line-through; }
    tr.fuera td:last-child { text-decoration: none; }
    .mal { color: var(--red); }
    .form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @media (max-width: 700px) { .form { grid-template-columns: 1fr; } }
    label { font-size: 11px; color: var(--mute); display: grid; gap: 4px; }
    label.check { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; }
    label.check input { width: auto; }
    .go, .no { grid-column: 1 / -1; background: var(--gold); color: var(--ink); border: none; padding: 12px;
      font: inherit; font-weight: 700; border-radius: 4px; text-align: center; text-decoration: none; cursor: pointer; }
    .no { background: transparent; color: var(--red); border: 1px solid var(--red); font-weight: 400; }
    .go:disabled { opacity: .45; }
    .aviso { margin-top: 14px; padding: 14px; border: 1px solid var(--gold); border-radius: 5px; background: #241f16;
      display: grid; gap: 8px; }
    .aviso.ok { border-color: var(--green); background: rgba(78,201,168,.07); }
    .aviso p { font-size: 13px; }
    .aviso small { color: var(--mute); }
    .feed { display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--line); border-radius: 6px;
      padding: 16px; background: var(--ink2); max-height: 50vh; overflow-y: auto; }
    .msg { max-width: 85%; }
    .msg .who { font-size: 10px; color: var(--mute); margin-bottom: 3px; }
    .msg .bub { padding: 8px 12px; border: 1px solid var(--line); border-radius: 3px 10px 10px 10px; font-size: 13px; background: #1c2634; }
    .msg .why { font-size: 10px; color: var(--mute); font-style: italic; margin-top: 4px; }
    .msg.seller { align-self: flex-end; }
    .msg.seller .who { color: var(--gold); }
    .msg.seller .bub { background: #241f16; border-color: #a8792f; border-radius: 10px 3px 10px 10px; }
    .msg.sys { align-self: center; text-align: center; }
    .msg.sys .bub { color: var(--green); border-color: var(--green); background: rgba(78,201,168,.07); font-size: 12px; }
    .msg.bad .bub { color: var(--red); border-color: var(--red); background: rgba(229,103,79,.07); }
  `,
})
export class Mercado {
  readonly market = inject(Market);
  readonly item = signal('botellas de agua');
  readonly qty = signal(100);
  readonly maxPrice = signal(60);
  readonly maxLeadDays = signal(7);
  readonly owner = signal('');
  readonly email = signal('');
  readonly authorize = signal(false);
  readonly error = signal('');

  readonly encontrados = computed(() => new Set(this.market.found().map((f) => f.seller)));
  readonly ordenadas = computed(() => [...this.market.quotes()].sort((a, b) => a.price - b.price));

  constructor() {
    this.market.connect();
    this.market.cargarCatalogo();
  }

  buscar() { this.market.buscar(this.item()); }

  async comprar() {
    this.error.set('');
    const r = await this.market.comprar({
      item: this.item(), qty: this.qty(), maxPrice: this.maxPrice(), maxLeadDays: this.maxLeadDays(),
      owner: this.owner() || 'Comprador', email: this.email(), authorize: this.authorize(),
    });
    if (r.error) this.error.set(r.error);
  }
}
