import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Market } from '../market';
import { Topbar } from '../topbar';

const plata = (n: number | null | undefined) => '$' + Number(n ?? 0).toLocaleString('es-CO');

// El coliseo: la mesa a la izquierda, el libro y el leaderboard a la derecha.
// Misma cabecera, mismo feed y mismas píldoras que el mercado.
@Component({
  selector: 'app-arena',
  imports: [RouterLink, Topbar],
  template: `
    <div class="page">
      <app-topbar />

      <section class="hero">
        <p class="eyebrow">Coliseo del guardián</p>
        <h1 class="display">Aquí los agentes intentan robar. El guardián determinista los expulsa.</h1>
        <div class="controls">
          <button class="primary" (click)="market.send({ type: 'arena_start', mode: 'auto' })">▶ abrir la arena</button>
          <button (click)="market.send({ type: 'arena_start', mode: 'supervised' })">▶ arena supervisada</button>
          <button (click)="market.send({ type: 'exploit_demo' })">🦈 escenario de explotación</button>
          <button class="ghost" (click)="market.send({ type: 'arena_stop' })">■ cerrar</button>
          <a routerLink="/atacar" class="hint">el público ataca desde el celular → <b>/atacar</b></a>
        </div>
      </section>

      <div class="stage">
        <div class="feed" #chat>
          @for (l of market.lines(); track $index) {
            <div class="msg {{ l.cls }}">
              <div class="who">{{ l.who }}</div>
              <div class="bub">@if (l.href) { <a [href]="l.href" target="_blank" rel="noopener">{{ l.text }}</a> } @else { {{ l.text }} }</div>
              @if (l.reason) { <div class="why">porque: {{ l.reason }}</div> }
            </div>
          }
          @if (!market.lines().length) { <p class="empty">abre la arena y mira la negociación mensaje a mensaje</p> }
        </div>

        <aside>
          <p class="eyebrow">libro en vivo</p>
          @for (a of accounts(); track a[0]) {
            <div class="acct">
              <div class="nm mono">{{ a[0] }}</div>
              <div class="val num">{{ plata(a[1].available) }}</div>
              <div class="esc">escrow {{ plata(a[1].escrowed) }}</div>
              @if (market.scenery().has(a[0])) { <div class="esc scenery">utilería · saldo emitido por la casa</div> }
            </div>
          }
          @if (!accounts().length) { <p class="esc">sin sesión abierta</p> }

          <p class="eyebrow sep">⚔ leaderboard</p>
          @for (b of market.board(); track b.name) {
            <div class="acct">
              <div class="nm mono">{{ b.name }} @if (b.sponsor) { · <span class="azul">{{ b.sponsor }}</span> }</div>
              @if (b.label) { <div class="lbl">{{ b.label }}</div> }
              <div class="esc">
                @if (b.expelled) { <span class="pill bad">expulsado</span> }
                @else if (b.queued) { <span class="pill warn">en cola</span> }
                @else { <span class="pill">{{ b.deals }} tratos</span> }
                <span>{{ b.violations }} violaciones</span>
              </div>
            </div>
          }
        </aside>
      </div>

      @if (market.approval(); as ap) {
        <div class="aviso approval">
          <p>🔔 Tu agente <b>{{ ap.agent }}</b> quiere cerrar {{ ap.qty }} u × {{ plata(ap.price) }} = <b>{{ plata(ap.total) }}</b> con {{ ap.seller }}</p>
          <div class="acciones">
            <button class="primary" (click)="market.answer('si')">✓ Sí</button>
            <button class="danger" (click)="market.answer('no')">✗ No</button>
            <input placeholder="otro: tu contraorden…" (input)="note.set($any($event.target).value)">
            <button (click)="market.answer('otro', note())">↩ Otro</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .hero { padding: 22px 0 8px; }
    .hero h1 { font-size: clamp(1.4rem, 2.6vw, 2rem); margin: 8px 0 16px; max-width: 34ch; }
    .controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .hint { font-size: .9rem; color: var(--mute); text-decoration: none; margin-left: auto; }
    .hint b { color: var(--gold); }
    .stage { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; margin-top: 18px; align-items: start; }
    @media (max-width: 900px) { .stage { grid-template-columns: 1fr; } }
    .feed { min-height: 420px; max-height: 68vh; }
    aside { background: var(--ink2); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; display: grid; gap: 12px; align-content: start; }
    aside .sep { margin-top: 10px; padding-top: 14px; border-top: 1px solid var(--line); }
    .acct .nm { color: var(--mute); font-size: .8rem; }
    .acct .val { font-size: 1.35rem; font-weight: 700; }
    .acct .esc, .acct .lbl { font-size: .8rem; color: var(--mute); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .acct .scenery { color: var(--gold); opacity: .8; }
    .azul { color: var(--blue); }
    .approval { margin-top: 16px; }
    .approval input { width: 260px; }
  `,
})
export class Arena {
  readonly market = inject(Market);
  readonly plata = plata;
  readonly note = signal('');
  private chat = viewChild<ElementRef<HTMLDivElement>>('chat');

  constructor() {
    this.market.connect();
    effect(() => {
      this.market.lines();
      const el = this.chat()?.nativeElement;
      if (el) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }

  accounts() { return Object.entries(this.market.balances()); }
}
