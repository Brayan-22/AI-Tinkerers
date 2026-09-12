import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Market } from '../market';

@Component({
  selector: 'app-arena',
  imports: [RouterLink],
  template: `
    <h1>MERCADIA <span class="live" [class.off]="!market.live()">● {{ market.live() ? 'EN VIVO' : 'SIN CONEXIÓN' }}</span></h1>

    <div class="controls">
      <button (click)="market.send({ type: 'arena_start', mode: 'auto' })">▶ abrir la arena</button>
      <button (click)="market.send({ type: 'arena_start', mode: 'supervised' })">▶ arena supervisada</button>
      <button (click)="market.send({ type: 'exploit_demo' })">🦈 escenario explotación</button>
      <button (click)="market.send({ type: 'arena_stop' })">■ cerrar</button>
      <a routerLink="/atacar" class="hint">ataca desde tu celular → <b>/atacar</b></a>
    </div>

    <div class="stage">
      <div id="chat" #chat>
        @for (l of market.lines(); track $index) {
          <div class="msg {{ l.cls }}">
            <div class="who">{{ l.who }}</div>
            <div class="bub">
              @if (l.href) { <a [href]="l.href" target="_blank" rel="noopener">{{ l.text }}</a> }
              @else { {{ l.text }} }
            </div>
            @if (l.reason) { <div class="why">porque: {{ l.reason }}</div> }
          </div>
        }
      </div>

      <aside>
        <h4>LIBRO EN VIVO</h4>
        @for (a of accounts(); track a[0]) {
          <div class="acct">
            <div class="nm">{{ a[0] }}</div>
            <div class="val">\${{ a[1].available.toLocaleString('es-CO') }}</div>
            <div class="esc">escrow \${{ a[1].escrowed.toLocaleString('es-CO') }}</div>
            @if (market.scenery().has(a[0])) { <div class="esc scenery">utilería · saldo emitido por la casa</div> }
          </div>
        }
        <h4 class="sep">⚔ LEADERBOARD</h4>
        @for (b of market.board(); track b.name) {
          <div class="acct">
            <div class="nm">{{ b.name }} @if (b.sponsor) { · <span class="who-blue">{{ b.sponsor }}</span> }</div>
            @if (b.label) { <div class="lbl">{{ b.label }}</div> }
            <div class="esc">
              {{ b.expelled ? '✕ EXPULSADO' : b.queued ? '⏳ en cola' : b.deals + ' tratos' }} · {{ b.violations }} violaciones
            </div>
          </div>
        }
      </aside>
    </div>

    @if (market.approval(); as ap) {
      <div id="approval">
        <p>🔔 Tu agente <b>{{ ap.agent }}</b> quiere cerrar {{ ap.qty }}u × \${{ ap.price }} = \${{ ap.total.toLocaleString('es-CO') }} con {{ ap.seller }}</p>
        <button (click)="market.answer('si')">✓ Sí</button>
        <button (click)="market.answer('no')">✗ No</button>
        <input placeholder="otro: tu contraorden…" (input)="note.set($any($event.target).value)">
        <button (click)="market.answer('otro', note())">↩ Otro</button>
      </div>
    }
  `,
  styles: `
    h1 { font-size: 16px; letter-spacing: .15em; color: var(--gold); margin-bottom: 14px; }
    .live { color: var(--red); font-size: 11px; margin-left: 10px; }
    .live.off { color: var(--mute); }
    .controls { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .hint { font-size: 11px; color: var(--mute); align-self: center; text-decoration: none; }
    .hint b { color: var(--gold); }
    .stage { display: grid; grid-template-columns: 1fr 260px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--ink2); }
    @media (max-width: 700px) { .stage { grid-template-columns: 1fr; } }
    #chat { padding: 18px; min-height: 380px; max-height: 60vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .msg { max-width: 85%; animation: rise .4s; }
    .msg .who { font-size: 10px; margin-bottom: 3px; color: var(--mute); }
    .msg .bub { padding: 8px 12px; border: 1px solid var(--line); border-radius: 3px 10px 10px 10px; font-size: 13px; background: #1c2634; }
    .msg .why { font-size: 10px; color: var(--mute); margin-top: 4px; font-style: italic; }
    .msg.buyer .who { color: var(--blue); }
    .msg.seller { align-self: flex-end; }
    .msg.seller .who { color: var(--gold); }
    .msg.seller .bub { background: #241f16; border-color: #a8792f; border-radius: 10px 3px 10px 10px; }
    .msg.sys { align-self: center; text-align: center; }
    .msg.sys .bub { color: var(--green); border-color: var(--green); background: rgba(78, 201, 168, .07); font-size: 12px; }
    .msg.bad .bub { color: var(--red); border-color: var(--red); background: rgba(229, 103, 79, .07); }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
    aside { border-left: 1px solid var(--line); padding: 18px; background: #11161f; }
    h4 { font-size: 10px; letter-spacing: .15em; color: var(--mute); margin-bottom: 12px; }
    h4.sep { margin-top: 20px; }
    .acct { margin-bottom: 12px; font-size: 12px; }
    .acct .nm { color: var(--mute); }
    .acct .val { font-size: 15px; font-weight: 700; }
    .acct .esc, .acct .lbl { font-size: 10px; color: var(--mute); }
    .acct .scenery { color: var(--gold); opacity: .75; }
    .who-blue { color: var(--blue); }
    #approval { border: 1px solid var(--gold); border-radius: 5px; padding: 14px; margin-top: 14px; background: #241f16; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    #approval p { font-size: 13px; width: 100%; margin-bottom: 6px; }
    #approval input { width: 220px; padding: 7px; }
  `,
})
export class Arena {
  readonly market = inject(Market);
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
