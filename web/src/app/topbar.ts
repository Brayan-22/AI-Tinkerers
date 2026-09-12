import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Market } from './market';

// La misma cabecera en las tres pantallas: la marca, a dónde ir y si el
// mercado está vivo. Antes cada pantalla traía la suya y desde la arena no
// había cómo volver al mercado.
@Component({
  selector: 'app-topbar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="top">
      <a routerLink="/" class="marca">
        <span class="nombre display">Mercadia</span>
        <span class="lema">el agente de compras que vive en la costura entre dos lugares</span>
      </a>
      <nav>
        <a routerLink="/" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: true }">mercado</a>
        <a routerLink="/arena" routerLinkActive="on">arena del guardián</a>
        <a routerLink="/atacar" routerLinkActive="on">atacar</a>
        <span class="pill" [class.ok]="market.live()" [class.bad]="!market.live()">
          <span class="dot" [class.pulse]="market.live()"></span>{{ market.live() ? 'en vivo' : 'sin conexión' }}
        </span>
      </nav>
    </header>
  `,
  styles: `
    .top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 10px 0 18px; border-bottom: 1px solid var(--line); }
    .marca { text-decoration: none; display: grid; gap: 2px; }
    .nombre { font-size: 1.75rem; color: var(--gold); }
    .lema { font-size: .85rem; color: var(--mute); }
    nav { display: flex; align-items: center; gap: 6px 18px; flex-wrap: wrap; font-size: .95rem; }
    nav a { color: var(--text2); text-decoration: none; padding: 6px 2px; border-bottom: 2px solid transparent; }
    nav a:hover { color: var(--paper); }
    nav a.on { color: var(--paper); border-bottom-color: var(--gold); }
    nav .pill { margin-left: 8px; }
  `,
})
export class Topbar {
  readonly market = inject(Market);
  constructor() { this.market.connect(); }
}
