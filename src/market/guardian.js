// Capa de seguridad — producto independiente del mercado.
// Principio: el LLM nunca es la frontera de seguridad. Todo acá es determinista:
// valida la acción ESTRUCTURADA de un agente contra su estado real en el ledger.
// El texto del chat es teatro; lo vinculante es lo que pasa por acá.
export class Guardian {
  constructor(ledger, { maxStrikes = 2, history = [], band = 0.15 } = {}) {
    this.ledger = ledger;
    this.maxStrikes = maxStrikes;
    this.strikes = new Map(); // name -> count
    this.banned = new Set();
    this.log = []; // auditoría: toda violación queda registrada
    this.history = history; // precios de tratos cerrados (compartida entre sesiones)
    this.band = band; // desviación tolerada vs. precio justo de mercado
  }

  // Protección al débil — el hueco que Project Deal dejó abierto: un agente
  // fuerte puede esquilmar a uno débil sin que su dueño lo note. Antes de
  // liquidar, el precio se compara contra la mediana del mercado.
  reviewDeal({ buyer, seller, price }) {
    if (this.history.length < 3) return { ok: true }; // sin referencia no hay veredicto
    const sorted = [...this.history].sort((a, b) => a - b);
    const fair = sorted[Math.floor(sorted.length / 2)];
    if (price > fair * (1 + this.band)) {
      return { ...this.#fail(seller, { type: 'deal', price }, `explotación: ${seller} le cobra $${price} a ${buyer} (mercado: ~$${fair}) — trato suspendido, dueño notificado`), offender: seller };
    }
    if (price < fair * (1 - this.band)) {
      return { ...this.#fail(buyer, { type: 'deal', price }, `explotación: ${buyer} le paga $${price} a ${seller} (mercado: ~$${fair}) — trato suspendido, dueño notificado`), offender: buyer };
    }
    return { ok: true };
  }

  // Valida mandato vs. acción. Devuelve {ok, reason}.
  check(name, action, book = {}) {
    if (this.banned.has(name)) return this.#fail(name, action, 'agente expulsado');
    // Identidad no falsificable: el canal dice quién eres, no tu mensaje.
    if (action.as && action.as !== name) {
      return this.#fail(name, action, `suplantación: dice ser ${action.as}`);
    }
    switch (action.type) {
      case 'offer': {
        const cost = action.price * action.qty;
        if (cost > this.ledger.available(name)) {
          return this.#fail(name, action, `oferta de $${cost} sin fondos (disponible: $${this.ledger.available(name)})`);
        }
        return { ok: true };
      }
      case 'accept': {
        if (!book[action.offerId]) return this.#fail(name, action, 'acepta un trato que no existe en el libro');
        return { ok: true };
      }
      case 'walk_away': // irse no es violación: se lleva su plata y deja de jugar
      case 'quote': // cotización del vendedor: no compromete fondos del que cotiza
      case 'talk':
      case 'reject':
        return { ok: true };
      default:
        return this.#fail(name, action, `acción desconocida: ${action.type}`);
    }
  }

  #fail(name, action, reason) {
    this.log.push({ name, action, reason, at: Date.now() });
    return { ok: false, reason };
  }

  strike(name) {
    const n = (this.strikes.get(name) ?? 0) + 1;
    this.strikes.set(name, n);
    if (n >= this.maxStrikes) this.banned.add(name);
    return this.banned.has(name);
  }

  expelled(name) { return this.banned.has(name); }
}
