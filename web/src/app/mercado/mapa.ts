import { Component, ElementRef, afterNextRender, effect, input, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { Listing } from '../market';

// El geovisor: dónde está cada proveedor. Marcadores SVG y no iconos de imagen,
// que es lo que evita el clásico icono roto de Leaflet con bundlers.
@Component({
  selector: 'app-mapa',
  template: '<div class="lienzo" #lienzo></div>',
  styles: `
    .lienzo { height: 400px; border: 1px solid var(--line); border-radius: var(--radius); background: #11161f; }
    @media (max-width: 700px) { .lienzo { height: 260px; } }
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
      // CARTO empezó a exigir API key y pinta "API KEY REQUIRED" en cada mosaico.
      // El lienzo gris oscuro de Esri no pide llave: base sin rótulos y una capa
      // de referencia con los nombres encima.
      const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_{c}/MapServer/tile/{z}/{y}/{x}';
      L.tileLayer(esri.replace('{c}', 'Base'), { maxZoom: 16, attribution: 'Tiles © Esri' }).addTo(this.mapa);
      L.tileLayer(esri.replace('{c}', 'Reference'), { maxZoom: 16, pane: 'shadowPane' }).addTo(this.mapa);
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
        radius: gana ? 14 : marcado ? 10 : 7,
        color: gana ? '#4ec9a8' : marcado ? '#e0a44a' : '#6ba3d6',
        weight: 2.5, fillOpacity: gana ? 0.8 : marcado ? 0.45 : 0.3,
      })
        .bindTooltip(`${a.owner} · ${a.city ?? ''}<br>${a.item} — $${a.minPrice} · ${a.leadDays} días`, { direction: 'top' })
        .addTo(this.capa);
    }
  }
}
