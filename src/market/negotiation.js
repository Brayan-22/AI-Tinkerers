// El corazón del mercado: corre rondas, enruta mensajes, mantiene el libro
// y solo él liquida. Los agentes jamás se pagan entre sí directamente.
// Dominio puro: nada de red, disco ni blockchain. Lo de afuera entra por
// los puertos del constructor (approve, notary, record, onEvent).
import { Ledger } from './ledger.js';
import { Guardian } from './guardian.js';
import { link, termSheet, canonical } from './term-sheet.js';

export class Negotiation {
  constructor({ approve, onEvent, record, notary, history, item } = {}) {
    this.ledger = new Ledger();
    this.guardian = new Guardian(this.ledger, { history });
    this.agents = [];
    this.item = item ?? null; // qué se está comprando en esta mesa
    this.book = {}; // offerId -> { id, from, price, qty, leadDays }
    this.lastQuote = null; // última cotización vista: el comprador regatea contra esto
    this.transcript = [];
    this.chainHead = ''; // cadena de hashes de todo lo que dijeron los agentes
    this.nextOfferId = 1; // por mesa: dos mercados en el mismo proceso no comparten libro
    this.left = new Set(); // los que se fueron por su cuenta (walk away)
    this.denied = new Set(); // tratos que el dueño ya rechazó: no se vuelve a preguntar
    this.approve = approve; // async (req) => {answer:'si'|'no'|'otro', text?} — modo supervisado
    this.notary = notary; // { sign(name,msg), verify(name,msg,sig) } — firma del acta
    this.onEvent = onEvent ?? (() => {});
    this.record = record; // (deal) => bool — deja constancia; false = ya estaba
  }

  addAgent(spec) {
    // spec: { name, owner?, role, budget, mode, maxPrice?, minPrice?, qty, brain, cheat? }
    this.agents.push({ owner: spec.name, mode: 'auto', ...spec });
    this.ledger.open(spec.name, spec.budget);
  }

  #emit(type, data) {
    const ev = { type, ...data, balances: this.ledger.snapshot() };
    this.transcript.push(ev);
    this.onEvent(ev);
  }

  #out(name) {
    return this.guardian.expelled(name) || this.left.has(name);
  }

  #active(role) {
    return this.agents.filter((a) => a.role === role && !this.#out(a.name));
  }

  #bestOfferFor() {
    const offers = Object.values(this.book);
    return offers.length ? offers.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  }

  async run({ maxRounds = 20, minRounds = 3 } = {}) {
    let deal = null;
    let round = 0;

    while (!deal && round < maxRounds && this.#active('buyer').length && this.#active('seller').length) {
      round++;
      for (const agent of this.agents) {
        if (deal || this.#out(agent.name)) continue;
        const view = { round, minRounds, item: this.item, bestOffer: this.#bestOfferFor(), lastQuote: this.lastQuote };
        const answer = await agent.brain(agent, view);
        // Frontera de confianza: un agente externo puede mandar cualquier cosa.
        const text = String(answer?.text ?? '').slice(0, 500);
        const reason = answer?.reason;
        const action = answer?.action ?? { type: 'talk' };

        // Cada mensaje encadena el hash del anterior. Editarlo o borrarlo
        // después rompe la cadena, y la cabeza es lo que se ancla on-chain.
        this.chainHead = link(this.chainHead, { agent: agent.name, text, action, reason });

        if (action.type === 'walk_away') {
          this.left.add(agent.name);
          this.#releaseOffersOf(agent.name);
          this.#emit('walk_away', { agent: agent.name, text, reason });
          continue;
        }

        // Una oferta viva por agente: liberar la anterior antes de validar la nueva,
        // si no, el escrow propio hace que el guardián rechace a un agente honesto.
        if (action.type === 'offer') this.#releaseOffersOf(agent.name);

        const verdict = this.guardian.check(agent.name, action, this.book);
        if (!verdict.ok) {
          const expelled = this.guardian.strike(agent.name);
          this.#emit('violation', { agent: agent.name, text, reason: verdict.reason, expelled });
          if (expelled) this.#releaseOffersOf(agent.name);
          continue;
        }

        this.#emit('message', { agent: agent.name, role: agent.role, text, action, reason });

        if (action.type === 'quote') this.lastQuote = { from: agent.name, price: action.price, qty: action.qty, leadDays: action.leadDays ?? null };

        if (action.type === 'offer') {
          this.ledger.commit(agent.name, action.price * action.qty);
          const id = `of-${this.nextOfferId++}`;
          this.book[id] = { id, from: agent.name, price: action.price, qty: action.qty, leadDays: action.leadDays ?? null };
        }

        if (action.type === 'accept') {
          deal = await this.#close(agent, this.book[action.offerId]);
        }
      }
    }

    if (!deal) for (const a of this.agents) this.#releaseOffersOf(a.name);
    return { deal, rounds: round, transcript: this.transcript, chainHead: this.chainHead };
  }

  // Cierra el trato: aprobación humana, revisión del guardián, firma de las dos
  // partes y recién ahí se mueve la plata. Cualquier paso que falle la devuelve.
  async #close(seller, offer) {
    const buyer = this.agents.find((a) => a.name === offer.from);
    const total = offer.price * offer.qty;

    // Al dueño se le pregunta una vez por trato, no una vez por ronda. Si ya
    // dijo que no a este vendedor a este precio, no se le vuelve a escribir.
    const yaPreguntado = `${seller.name}:${offer.price}`;
    if (this.denied.has(yaPreguntado)) {
      this.#releaseOffersOf(buyer.name);
      return null;
    }

    if (buyer.mode === 'supervised' && this.approve) {
      this.#emit('approval_request', { agent: buyer.name, seller: seller.name, price: offer.price, qty: offer.qty, total });
      const res = await this.approve({ agent: buyer.name, seller: seller.name, price: offer.price, qty: offer.qty, total });
      if (res.answer !== 'si') {
        this.denied.add(yaPreguntado);
        this.#emit('approval_denied', { agent: buyer.name, answer: res.answer, note: res.text });
        this.#releaseOffersOf(buyer.name);
        return null;
      }
    }

    const review = this.guardian.reviewDeal({ buyer: buyer.name, seller: seller.name, price: offer.price });
    if (!review.ok) {
      this.#emit('exploitation_alert', { buyer: buyer.name, seller: seller.name, price: offer.price, reason: review.reason });
      this.guardian.strike(review.offender);
      this.#releaseOffersOf(buyer.name);
      return null;
    }

    const sheet = termSheet({
      item: this.item, buyer: buyer.name, seller: seller.name,
      price: offer.price, qty: offer.qty, leadDays: offer.leadDays,
      chainHead: this.chainHead,
    });
    if (!(await this.#sign(sheet))) {
      this.#releaseOffersOf(buyer.name);
      return null;
    }

    const deal = { id: sheet.id, buyer: buyer.name, seller: seller.name, price: offer.price, qty: offer.qty, total, sheet };

    // Primero el registro, después la plata. Al revés, un corte entre las dos
    // deja dinero movido sin constancia de por qué se movió.
    if (this.record && !(await this.record(deal))) {
      this.#emit('duplicate', { agent: buyer.name, reason: `el trato ${sheet.id} ya estaba registrado — no se paga dos veces` });
      this.#releaseOffersOf(buyer.name);
      return null;
    }

    this.ledger.settle(buyer.name, seller.name, total);
    this.guardian.history.push(offer.price);
    delete this.book[offer.id];
    this.#emit('deal', deal);
    return deal;
  }

  // ponytail: sin notario inyectado no hay compuerta de firma (demo y tests
  // viejos siguen corriendo). El arranque de producción siempre inyecta uno.
  async #sign(sheet) {
    if (!this.notary) return true;
    const msg = canonical(sheet);
    for (const name of [sheet.buyer, sheet.seller]) {
      const sig = await this.notary.sign(name, msg).catch(() => null);
      const ok = sig && (await this.notary.verify(name, msg, sig).catch(() => false));
      if (!ok) {
        this.#emit('unsigned', { agent: name, sheet, reason: `${name} no firmó el acta — trato suspendido` });
        return false;
      }
      sheet.signatures[name] = sig;
    }
    return true;
  }

  #releaseOffersOf(name) {
    for (const [id, o] of Object.entries(this.book)) {
      if (o.from === name) {
        this.ledger.release(name, o.price * o.qty);
        delete this.book[id];
      }
    }
  }
}
