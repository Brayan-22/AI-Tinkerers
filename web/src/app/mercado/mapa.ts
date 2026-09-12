import { Component, ElementRef, afterNextRender, effect, input, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { Listing } from '../market';

// El geovisor: dónde está cada proveedor. Marcadores SVG y no iconos de imagen,
// que es lo que evita el clásico icono roto de Leaflet con bundlers.
@Component({
  selector: 'app-mapa',
  template: '<div class="lienzo" #lienzo></div>',
  styles: `
    .lienzo { height: 340px; border: 1px solid var(--line); border-radius: 6px; background: #11161f; }
    /* El mapa de OSM es claro; esto lo vuelve oscuro sin necesitar otra fuente. */
    .lienzo ::ng-deep .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9); }
    .lienzo ::ng-deep .leaflet-control-attribution { background: rgba(0,0,0,.5); color: var(--mute); }
    .lienzo ::ng-deep .leaflet-control-attribution a { color: var(--mute); }
    @media (max-width: 700px) { .lienzo { height: 240px; } }
  `,
})
export class Mapa {
  readonly agents = input<Listing[]>([]);
  readonly destacados = input<Set<string>>(new Set<string>());
  readonly ganador = input<string | null>(null);

  private lienzo = viewChild.required<ElementRef<HTMLDivElement>>('lienzo');
  private mapa?: L.Map;
  private capa?: L.LayerGroup;

  constructor() {
    afterNextRender(() => {
      this.mapa = L.map(this.lienzo().nativeElement, { worldCopyJump: true }).setView([8, -60], 2);
      // OpenStreetMap directo: no pide llave. Se oscurece por CSS para que
      // encaje con la página, en vez de depender de un basemap con cuenta.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12, attribution: '© OpenStreetMap',
      }).addTo(this.mapa);
      this.capa = L.layerGroup().addTo(this.mapa);
      this.pintar();
    });
    effect(() => { this.agents(); this.destacados(); this.ganador(); this.pintar(); });
  }

  private pintar(): void {
    if (!this.capa) return;
    this.capa.clearLayers();
    for (const a of this.agents()) {
      if (a.lat == null || a.lon == null) continue;
      const gana = a.seller === this.ganador();
      const marcado = this.destacados().has(a.seller);
      L.circleMarker([a.lat, a.lon], {
        radius: gana ? 11 : marcado ? 8 : 5,
        color: gana ? '#4ec9a8' : marcado ? '#e0a44a' : '#6ba3d6',
        weight: 2, fillOpacity: gana ? 0.7 : 0.25,
      })
        .bindTooltip(`${a.owner} · ${a.city ?? ''}<br>${a.item} — $${a.minPrice} · ${a.leadDays} días`, { direction: 'top' })
        .addTo(this.capa);
    }
  }
}
