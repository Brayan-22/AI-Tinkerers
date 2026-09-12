import { Component, signal } from '@angular/core';
import { Topbar } from '../topbar';

const STRATEGIES = [
  { id: 'sin-fondos', label: 'Ofertar plata que no tengo' },
  { id: 'fantasma', label: 'Cobrar un trato que no existe' },
  { id: 'suplantacion', label: 'Hacerme pasar por otro agente' },
  { id: 'manipulacion', label: 'Manipular a los otros agentes con palabras' },
];

// La pantalla del celular del público: un nombre, una estrategia, un botón.
@Component({
  selector: 'app-attack',
  imports: [Topbar],
  template: `
    <div class="page">
      <app-topbar />
      <section class="card tarjeta">
        <p class="eyebrow">⚔ suelta tu ladrón</p>
        @if (sent()) {
          <h1 class="display">Listo. <span class="mono ok">{{ sent() }}</span> entra en la próxima sesión.</h1>
          <p class="sub">Mira la pantalla grande. Tu nombre queda en el leaderboard, para bien o para mal.</p>
          <button class="primary lg" (click)="sent.set(null)">soltar otro</button>
        } @else {
          <h1 class="display">Tu agente entra al mercado a intentar robar.</h1>
          <p class="sub">El guardián intentará atraparlo. Tu nombre queda en el leaderboard, para bien o para mal.</p>
          <label>tu nombre <input maxlength="24" placeholder="como quieres aparecer en pantalla" (input)="name.set($any($event.target).value)"></label>
          <label>estrategia de robo
            <select (change)="strategy.set($any($event.target).value)">
              @for (s of strategies; track s.id) { <option [value]="s.id">{{ s.label }}</option> }
            </select>
          </label>
          <button class="primary lg" [disabled]="!name().trim()" (click)="attack()">⚔ atacar el mercado</button>
        }
      </section>
    </div>
  `,
  styles: `
    .tarjeta { max-width: 540px; margin: 40px auto 0; display: grid; gap: 16px; padding: 28px; }
    .tarjeta button { width: 100%; }
    h1 { font-size: 1.6rem; }
    .sub { color: var(--text2); }
  `,
})
export class Attack {
  readonly strategies = STRATEGIES;
  readonly name = signal('');
  readonly strategy = signal(STRATEGIES[0].id);
  readonly sent = signal<string | null>(null);

  async attack() {
    const res = await fetch('/api/attack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: this.name(), estrategia: this.strategy() }),
    });
    const { name } = await res.json();
    this.sent.set(name);
  }
}
