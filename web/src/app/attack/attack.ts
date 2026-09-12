import { Component, signal } from '@angular/core';

const STRATEGIES = [
  { id: 'sin-fondos', label: 'Ofertar plata que no tengo' },
  { id: 'fantasma', label: 'Cobrar un trato que no existe' },
  { id: 'suplantacion', label: 'Hacerme pasar por otro agente' },
  { id: 'manipulacion', label: 'Manipular a los otros agentes con palabras' },
];

@Component({
  selector: 'app-attack',
  template: `
    <h1>⚔ SUELTA TU LADRÓN</h1>
    @if (sent()) {
      <p>Listo. Tu agente <b>{{ sent() }}</b> entra en la próxima sesión. Mira la pantalla grande.</p>
      <button (click)="sent.set(null)">soltar otro</button>
    } @else {
      <p>Tu agente entrará al mercado a intentar robar. El guardián intentará atraparlo. Tu nombre queda en el leaderboard, para bien o para mal.</p>
      <label>Tu nombre</label>
      <input maxlength="24" placeholder="como quieres aparecer en pantalla" (input)="name.set($any($event.target).value)">
      <label>Estrategia de robo</label>
      <select (change)="strategy.set($any($event.target).value)">
        @for (s of strategies; track s.id) { <option [value]="s.id">{{ s.label }}</option> }
      </select>
      <button class="go" [disabled]="!name().trim()" (click)="attack()">⚔ ATACAR EL MERCADO</button>
    }
  `,
  styles: `
    :host { display: block; max-width: 420px; margin: 0 auto; padding: 28px 0; }
    h1 { font-size: 18px; color: var(--gold); letter-spacing: .1em; margin-bottom: 6px; }
    p { font-size: 13px; color: var(--mute); margin-bottom: 22px; }
    p b { color: var(--paper); }
    label { display: block; font-size: 11px; letter-spacing: .12em; color: var(--mute); margin: 16px 0 6px; text-transform: uppercase; }
    .go { width: 100%; margin-top: 24px; background: var(--gold); color: var(--ink); border: none; padding: 14px; font-weight: 700; letter-spacing: .06em; }
    .go:disabled { opacity: .4; }
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
