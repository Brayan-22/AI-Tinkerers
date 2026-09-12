// Libro contable en memoria: la fuente de verdad de la demo.
// La liquidación on-chain (chain.js) es el espejo verificable, no el árbitro.
export class Ledger {
  constructor() {
    this.accounts = new Map(); // name -> { available, escrowed }
  }

  open(name, amount = 0) {
    this.accounts.set(name, { available: amount, escrowed: 0 });
  }

  #get(name) {
    const a = this.accounts.get(name);
    if (!a) throw new Error(`cuenta inexistente: ${name}`);
    return a;
  }

  available(name) { return this.#get(name).available; }
  escrowed(name) { return this.#get(name).escrowed; }

  // Compromete fondos (available -> escrow). Es la barrera: sin esto no hay oferta vinculante.
  commit(name, amount) {
    const a = this.#get(name);
    if (amount <= 0 || amount > a.available) throw new Error(`fondos insuficientes: ${name}`);
    a.available -= amount;
    a.escrowed += amount;
  }

  release(name, amount) {
    const a = this.#get(name);
    if (amount > a.escrowed) throw new Error(`escrow insuficiente: ${name}`);
    a.escrowed -= amount;
    a.available += amount;
  }

  // Liquida un trato: escrow del comprador -> disponible del vendedor.
  settle(from, to, amount) {
    const f = this.#get(from), t = this.#get(to);
    if (amount > f.escrowed) throw new Error(`escrow insuficiente para liquidar: ${from}`);
    f.escrowed -= amount;
    t.available += amount;
  }

  snapshot() {
    return Object.fromEntries([...this.accounts].map(([k, v]) => [k, { ...v }]));
  }
}
