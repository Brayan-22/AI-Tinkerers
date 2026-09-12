import { Injectable, signal } from '@angular/core';

export interface Line { cls: string; who: string; text: string; reason?: string; href?: string; }
export interface Account { available: number; escrowed: number; }
export interface BoardRow {
  name: string; sponsor?: string; label?: string; queued?: boolean;
  deals: number; violations: number; expelled: number;
}
export interface Approval { agent: string; seller: string; price: number; qty: number; total: number; }
export interface Listing {
  seller: string; owner: string; item: string; leadDays: number; minPrice: number;
  lat: number | null; lon: number | null; city: string | null; country: string | null;
  deals: number; violations: number;
  source: 'telegram' | 'exa' | 'demo' | null;  // de dónde salió este proveedor
  url: string | null;
  telegram: string | null;
}
export interface Quote { seller: string; owner?: string; price: number; leadDays: number; reason?: string; }
export interface Awarded { seller: string; price: number; leadDays: number; total: number; }
export interface Contrato { url: string; dealId: string; seller: string; funded: boolean; }
export interface CorreoPendiente { to: string | null; link: string | null; rejectLink: string | null; note: string; seller: string; total: number; }

const money = (n: number) => '$' + Number(n ?? 0).toLocaleString('es-CO');

// Único punto de contacto con el backend. Los componentes solo leen señales.
@Injectable({ providedIn: 'root' })
export class Market {
  private socket?: WebSocket;
  readonly lines = signal<Line[]>([]);
  readonly balances = signal<Record<string, Account>>({});
  readonly board = signal<BoardRow[]>([]);
  readonly approval = signal<Approval | null>(null);
  readonly scenery = signal<Set<string>>(new Set()); // agentes de la casa: saldo emitido, no depositado

  // Estado de la compra en curso
  readonly catalog = signal<Listing[]>([]);
  readonly found = signal<Listing[]>([]);
  readonly rfqId = signal<string | null>(null);
  readonly demanda = signal<{ item: string; qty: number } | null>(null);
  readonly enMesa = signal(0); // proveedores cotizando en la compra que se mira
  readonly quotes = signal<Quote[]>([]);
  readonly rejected = signal<(Quote & { reason: string })[]>([]);
  readonly award = signal<Awarded | null>(null);
  readonly contrato = signal<Contrato | null>(null);
  readonly correo = signal<CorreoPendiente | null>(null);
  readonly comprando = signal(false);
  readonly live = signal(false);

  connect(): void {
    if (this.socket) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => this.live.set(true);
    socket.onmessage = (e) => this.absorb(JSON.parse(e.data));
    socket.onclose = () => {
      this.live.set(false);
      this.socket = undefined;
      setTimeout(() => this.connect(), 2000); // la pantalla del coliseo no se puede quedar muerta
    };
  }

  // El token de operación viaja en la URL: /arena?t=EL_TOKEN. Va en cada
  // mensaje porque el servidor solo lo exige en los mandos.
  private readonly token = new URLSearchParams(location.search).get('t') ?? undefined;

  send(msg: Record<string, unknown>): void {
    this.socket?.send(JSON.stringify(this.token ? { ...msg, token: this.token } : msg));
  }

  async cargarCatalogo(): Promise<void> {
    this.catalog.set(await fetch('/api/catalog').then((r) => r.json()));
  }

  async buscar(item: string): Promise<void> {
    if (!item.trim()) return this.found.set([]);
    this.found.set(await fetch(`/api/search?item=${encodeURIComponent(item)}`).then((r) => r.json()));
  }

  async comprar(body: Record<string, unknown>): Promise<{ error?: string; suppliers?: number }> {
    this.comprando.set(true);
    this.quotes.set([]); this.rejected.set([]); this.award.set(null);
    this.contrato.set(null); this.correo.set(null); this.lines.set([]);
    const res = await fetch('/api/buy', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) this.comprando.set(false);
    return data;
  }

  answer(answer: 'si' | 'no' | 'otro', text = ''): void {
    this.send({ type: 'approval', answer, text });
    this.approval.set(null);
  }

  private say(line: Line): void { this.lines.update((ls) => [...ls, line]); }

  private absorb(ev: any): void {
    if (ev.balances) this.balances.set(ev.balances);

    // Los eventos de una compra ajena no pisan la que estoy mirando.
    if (ev.rfq && this.rfqId() && ev.rfq !== this.rfqId() && ev.type !== 'rfq_open') return;

    switch (ev.type) {
      case 'leaderboard': return this.board.set(ev.board);
      case 'denied':
        return this.say({ cls: 'sys bad', who: 'mercado', text: ev.reason });

      case 'rfq_open':
        this.rfqId.set(ev.rfq);
        this.demanda.set({ item: ev.item, qty: ev.qty });
        this.enMesa.set(ev.suppliers?.length ?? 0);
        this.comprando.set(true);
        this.quotes.set([]); this.rejected.set([]); this.award.set(null); this.contrato.set(null);
        return this.say({ cls: 'sys', who: 'mercado', text: `${ev.buyer} pide ${ev.qty} × ${ev.item} a ${ev.suppliers.length} proveedores`, reason: `tope ${money(ev.maxPrice)} por unidad, entrega en ${ev.maxLeadDays} días` });
      case 'quote_received':
        this.quotes.update((qs) => [...qs, ev]);
        return this.say({ cls: 'seller', who: ev.seller, text: `${money(ev.price)} la unidad, entrega en ${ev.leadDays} días`, reason: ev.reason });
      case 'quote_rejected':
        this.rejected.update((qs) => [...qs, ev]);
        return this.say({ cls: 'sys bad', who: 'descartada', text: `${ev.seller}: ${ev.reason}` });
      case 'awarded':
        this.award.set(ev);
        return this.say({ cls: 'sys', who: 'adjudicación', text: `gana ${ev.seller}: ${money(ev.price)} × ${ev.leadDays} días = ${money(ev.total)}` });
      case 'award_failed':
        this.comprando.set(false);
        return this.say({ cls: 'sys bad', who: 'adjudicación', text: `${ev.seller} no cerró el trato` });
      case 'rfq_empty':
        this.comprando.set(false);
        return this.say({ cls: 'sys bad', who: 'mercado', text: `${ev.cotizadas} cotizaciones y ninguna sirve` });
      case 'contract':
        this.comprando.set(false);
        this.contrato.set(ev);
        return this.say({ cls: 'sys', who: 'contrato', text: 'contrato firmado y anclado', href: ev.url });
      case 'approval_email':
        this.correo.set(ev);
        return this.say({ cls: 'sys', who: 'autorización', text: ev.to ? `esperando que ${ev.to} autorice` : 'esperando autorización', reason: ev.note });
      case 'approval_decided':
        this.correo.set(null);
        return this.say({ cls: 'sys', who: 'autorización', text: ev.answer === 'si' ? 'autorizado' : 'rechazado' });
      case 'approval_timeout':
        this.correo.set(null);
        this.comprando.set(false);
        return this.say({ cls: 'sys bad', who: 'autorización', text: 'nadie autorizó a tiempo: el trato se cae' });
      case 'listing':
        return this.say({ cls: 'sys', who: 'catálogo', text: `${ev.owner} publica ${ev.item}` });
      case 'scenario_start':
        this.lines.set([]);
        this.scenery.set(new Set(ev.scenery ?? []));
        return this.say({ cls: 'sys', who: 'mercado', text: `sesión ${ev.session} abierta` + (ev.fighters?.length ? ` — entran: ${ev.fighters.join(', ')}` : '') });
      case 'message':
        return this.say({ cls: ev.role, who: ev.agent, text: ev.text, reason: ev.reason });
      case 'violation':
        return this.say({ cls: 'sys bad', who: 'GUARDIÁN', text: `${ev.agent}: ${ev.reason}${ev.expelled ? ' — EXPULSADO' : ' (strike)'}` });
      case 'walk_away':
        return this.say({ cls: 'sys', who: 'mercado', text: `${ev.agent} se retira de la mesa`, reason: ev.reason });
      case 'unsigned':
        return this.say({ cls: 'sys bad', who: 'NOTARÍA', text: ev.reason });
      case 'exploitation_alert':
        return this.say({ cls: 'sys bad', who: 'GUARDIÁN · PROTECCIÓN AL DÉBIL', text: ev.reason });
      case 'approval_request':
        return this.approval.set(ev);
      case 'approval_denied':
        return this.say({ cls: 'sys bad', who: 'dueño', text: `contraorden: ${ev.answer}${ev.note ? ' — ' + ev.note : ''}` });
      case 'deal':
        return this.say({ cls: 'sys', who: 'mercado', text: `TRATO FIRMADO · ${ev.qty}u × ${money(ev.price)} · ${money(ev.total)}` });
      case 'duplicate':
        return this.say({ cls: 'sys bad', who: 'mercado', text: ev.reason });
      case 'deposit':
        return this.say({ cls: 'sys', who: 'escrow', text: `depósitos acreditados: ${money(ev.total)}` });
      case 'withdrawal':
        return this.say({ cls: 'sys', who: 'escrow', text: `${ev.name} retira ${money(ev.amount)}${ev.receipt?.error ? ' (falló, se devolvió)' : ''}`, href: ev.receipt?.explorer });
      case 'notarized':
        return this.say({ cls: 'sys', who: 'acta notarial', text: `hash de la negociación: ${String(ev.hash).slice(0, 18)}…`, href: ev.explorer });
      case 'external_join':
        return this.say({ cls: 'sys', who: 'mercado', text: `agente externo: ${ev.name} (${ev.owner}) — ${ev.role}, saldo ${money(ev.balance)}` });
      case 'attacker_queued':
        return this.say({ cls: 'sys', who: 'coliseo', text: `${ev.sponsor} suelta un ladrón: ${ev.label}` });
      case 'scenario_end':
        return this.say({ cls: 'sys', who: 'mercado', text: ev.deal ? 'sesión cerrada con trato' : 'sesión cerrada sin trato' });
    }
  }
}
