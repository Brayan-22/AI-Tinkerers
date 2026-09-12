// Una compra de verdad: el comprador pide cotización a varios proveedores a la
// vez, compara precio y plazo, y cierra con uno solo.
//
// Dos fases, por una razón concreta: cotizar no compromete fondos, cerrar sí.
// Si el comprador ofertara en paralelo a cinco proveedores comprometería cinco
// veces su plata, y el guardián lo expulsaría por ofertar sin fondos. Así que
// primero se pregunta (quote) y solo con el ganador se oferta (offer + escrow).
import { randomUUID } from 'node:crypto';
import { Negotiation } from './negotiation.js';

const RONDAS_COTIZACION = 3; // regateo antes de pedir el número final

// La regla, dicha en voz alta: lo más barato que cumpla. Empate → el más rápido.
export function mejorCotizacion(quotes) {
  return [...quotes].sort((a, b) => a.price - b.price || a.leadDays - b.leadDays)[0] ?? null;
}

export class Rfq {
  constructor({ demand, suppliers, notary, record, history, approve, onEvent, id, rondas } = {}) {
    this.demand = demand;
    this.suppliers = suppliers ?? [];
    this.notary = notary;
    this.record = record;
    this.history = history;
    this.approve = approve;
    this.onEvent = onEvent ?? (() => {});
    // Con proveedores humanos se pregunta menos veces: nadie aguanta tres
    // mensajes seguidos de un desconocido.
    this.rondas = rondas ?? RONDAS_COTIZACION;
    this.id = id ?? randomUUID();
  }

  #emit(type, data) {
    this.onEvent({ type, rfq: this.id, item: this.demand.item, ...data });
  }

  #descarte(q) {
    const { qty, maxPrice, maxLeadDays, budget } = this.demand;
    // Un límite que el comprador no puso no descarta a nadie. Inventar un techo
    // y después rechazar por él es peor que no tener techo.
    if (maxLeadDays != null && q.leadDays > maxLeadDays) return `plazo de ${q.leadDays} días y el tope es ${maxLeadDays}`;
    if (maxPrice != null && q.price > maxPrice) return `$${q.price} por unidad y el techo es $${maxPrice}`;
    if (budget != null && q.price * qty > budget) return `$${q.price * qty} no cabe en el presupuesto de $${budget}`;
    return null;
  }

  async run() {
    const { buyer, item, qty, maxPrice, maxLeadDays } = this.demand;
    this.#emit('rfq_open', { buyer, qty, maxPrice, maxLeadDays, suppliers: this.suppliers.map((s) => s.name) });

    // Todas las cotizaciones en paralelo: hablar con diez proveedores no puede
    // costar diez veces lo que cuesta hablar con uno.
    const quotes = (await Promise.all(this.suppliers.map((s) => this.#cotizar(s)))).filter(Boolean);

    const descartadas = [];
    const viables = quotes.filter((q) => {
      const reason = this.#descarte(q);
      if (reason) { descartadas.push({ ...q, reason }); this.#emit('quote_rejected', { ...q, reason }); return false; }
      return true;
    });

    const ordenadas = [...viables].sort((a, b) => a.price - b.price || a.leadDays - b.leadDays);
    if (!ordenadas.length) {
      this.#emit('rfq_empty', { cotizadas: quotes.length, descartadas });
      return { deal: null, quotes, descartadas, winner: null };
    }

    // Si el primero se echa para atrás, se intenta con el siguiente. Nadie se
    // queda sin respuesta porque un proveedor se arrepintió.
    for (const candidata of ordenadas) {
      const deal = await this.#adjudicar(candidata, ordenadas.length);
      if (deal) return { deal, quotes, descartadas, winner: candidata };
    }

    // Ninguno cerró: al menos se entrega la mejor que se consiguió, para que
    // el comprador decida por fuera en vez de quedarse con las manos vacías.
    this.#emit('sin_cierre', { mejor: ordenadas[0], intentos: ordenadas.length });
    return { deal: null, quotes, descartadas, winner: ordenadas[0] };
  }

  // Fase 1: preguntar. Nadie compromete plata todavía.
  async #cotizar(supplier) {
    const { buyer, owner, item, qty, maxPrice, maxLeadDays } = this.demand;
    const mesa = new Negotiation({
      item, notary: this.notary,
      onEvent: (ev) => this.onEvent({ ...ev, rfq: this.id, seller: supplier.name }),
    });
    mesa.addAgent({ name: buyer, owner, role: 'buyer', budget: 0, qty, maxPrice, maxLeadDays, item, brain: this.demand.brain });
    mesa.addAgent({ ...supplier });
    // minRounds alto a propósito: en la fase de cotización nadie cierra nada.
    await mesa.run({ maxRounds: this.rondas, minRounds: this.rondas + 99 });

    const ultima = [...mesa.transcript].reverse()
      .find((e) => e.type === 'message' && e.agent === supplier.name && e.action?.type === 'quote');
    if (!ultima) {
      // No se le inventa nada: se dice que no cotizó y por qué, y la mesa sigue.
      const porQue = [...mesa.transcript].reverse().find((e) => e.type === 'message' && e.agent === supplier.name)?.reason;
      this.#emit('no_quote', { seller: supplier.name, owner: supplier.owner ?? supplier.name, humano: Boolean(supplier.humano), reason: porQue ?? 'no cotizó' });
      return null;
    }

    const quote = {
      seller: supplier.name, owner: supplier.owner ?? supplier.name,
      price: ultima.action.price, qty,
      leadDays: ultima.action.leadDays ?? supplier.leadDays ?? null,
      reason: ultima.reason,
    };
    this.#emit('quote_received', quote);
    return quote;
  }

  // Fase 2: cerrar con el ganador. Acá sí hay escrow, guardián, firmas y plata.
  async #adjudicar(q, compitieron) {
    const { buyer, owner, item, qty, budget, mode } = this.demand;
    const supplier = this.suppliers.find((s) => s.name === q.seller);

    const mesa = new Negotiation({
      item, notary: this.notary, record: this.record, history: this.history,
      approve: this.approve && ((req) => this.approve({ ...req, item, leadDays: q.leadDays, rfq: this.id })),
      onEvent: (ev) => this.onEvent({ ...ev, rfq: this.id, seller: q.seller }),
    });

    mesa.addAgent({
      name: buyer, owner, role: 'buyer', budget, mode: mode ?? 'auto', qty, maxPrice: q.price, item,
      brain: () => ({
        text: `Cerramos: ${qty} de ${item} a $${q.price} la unidad, entrega en ${q.leadDays} días.`,
        reason: `la mejor de ${compitieron} cotizaciones que cumplen plazo y techo`,
        action: { type: 'offer', price: q.price, qty, leadDays: q.leadDays },
      }),
    });
    mesa.addAgent({ ...supplier });

    const { deal } = await mesa.run({ maxRounds: 2, minRounds: 1 });
    if (deal) this.#emit('awarded', { seller: q.seller, price: q.price, leadDays: q.leadDays, total: deal.total, dealId: deal.id });
    else this.#emit('award_failed', { seller: q.seller, price: q.price });
    return deal;
  }
}
