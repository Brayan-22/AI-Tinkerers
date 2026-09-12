// Persistencia. Sin esto el mercado pierde la memoria en cada reinicio y el
// detector de explotación se queda ciego: necesita la historia de precios.
// node:sqlite es stdlib en Node 22 — cero dependencias, un archivo, un volumen.
// ponytail: un solo archivo SQLite. Migrar a Postgres cuando haya más de un
// proceso escribiendo, no antes.
import { env } from './secrets.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(path = env('DB_PATH', './data/mercadia.db')) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY, buyer TEXT, seller TEXT, price REAL, qty INTEGER,
      total REAL, chain_head TEXT, signatures TEXT, closed_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session INTEGER, type TEXT,
      payload TEXT, at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY, owner TEXT, deals INTEGER DEFAULT 0,
      violations INTEGER DEFAULT 0, expelled INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS credits (
      tx_hash TEXT, log_index INTEGER, from_address TEXT, amount REAL,
      applied INTEGER DEFAULT 0, at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS listings (
      seller TEXT, item TEXT, lead_days INTEGER, min_price REAL,
      PRIMARY KEY (seller, item)
    );
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY, html TEXT, sheet TEXT, at INTEGER DEFAULT (unixepoch())
    );
  `);
  // ponytail: migración de pobre. Con dos columnas más, un archivo de esquema.
  try { db.exec('ALTER TABLE agents ADD COLUMN available REAL'); } catch { /* ya existe */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN address TEXT'); } catch { /* ya existe */ }
  for (const col of ['lat REAL', 'lon REAL', 'city TEXT', 'country TEXT', 'custody_key TEXT', 'custody_address TEXT', 'telegram TEXT']) {
    try { db.exec(`ALTER TABLE agents ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }
  try { db.exec('ALTER TABLE deals ADD COLUMN item TEXT'); } catch { /* ya existe */ }
  try { db.exec('ALTER TABLE deals ADD COLUMN channel TEXT'); } catch { /* ya existe */ }
  for (const col of ['source TEXT', 'url TEXT']) {
    try { db.exec(`ALTER TABLE listings ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }

  const q = {
    insertDeal: db.prepare(
      'INSERT OR IGNORE INTO deals (id,buyer,seller,price,qty,total,chain_head,signatures,item,channel) VALUES (?,?,?,?,?,?,?,?,?,?)'),
    prices: db.prepare(
      'SELECT price FROM (SELECT rowid AS r, price FROM deals ORDER BY r DESC LIMIT ?) ORDER BY r ASC'),
    pricesOf: db.prepare(
      'SELECT price FROM (SELECT rowid AS r, price FROM deals WHERE item = ? ORDER BY r DESC LIMIT ?) ORDER BY r ASC'),
    place: db.prepare('UPDATE agents SET lat = ?, lon = ?, city = ?, country = ? WHERE name = ?'),
    precioCanal: db.prepare(`SELECT price FROM (SELECT rowid AS r, price FROM deals
      WHERE channel = ? AND item = ? ORDER BY r DESC LIMIT ?) ORDER BY r ASC`),
    ultimoCanal: db.prepare(`SELECT seller, price, qty, total, closed_at FROM deals
      WHERE channel = ? AND item = ? ORDER BY rowid DESC LIMIT 1`),
    listar: db.prepare(`INSERT INTO listings (seller,item,lead_days,min_price,source,url) VALUES (?,?,?,?,?,?)
      ON CONFLICT(seller,item) DO UPDATE SET lead_days = excluded.lead_days, min_price = excluded.min_price,
        source = COALESCE(excluded.source, source), url = COALESCE(excluded.url, url)`),
    catalogo: db.prepare(`SELECT l.seller, l.item, l.lead_days AS leadDays, l.min_price AS minPrice,
        l.source, l.url, a.owner, a.lat, a.lon, a.city, a.country, a.deals, a.violations, a.telegram
      FROM listings l JOIN agents a ON a.name = l.seller ORDER BY l.item, l.min_price`),
    buscar: db.prepare(`SELECT l.seller, l.item, l.lead_days AS leadDays, l.min_price AS minPrice,
        l.source, l.url, a.owner, a.lat, a.lon, a.city, a.country, a.deals, a.violations, a.telegram
      FROM listings l JOIN agents a ON a.name = l.seller
      WHERE l.item LIKE ? ORDER BY l.min_price`),
    guardarContrato: db.prepare('INSERT OR REPLACE INTO contracts (id,html,sheet) VALUES (?,?,?)'),
    contrato: db.prepare('SELECT id, html, sheet FROM contracts WHERE id = ?'),
    event: db.prepare('INSERT INTO events (session,type,payload) VALUES (?,?,?)'),
    agent: db.prepare('INSERT INTO agents (name,owner) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET owner=COALESCE(excluded.owner,owner)'),
    deal: db.prepare('UPDATE agents SET deals = deals + 1 WHERE name = ?'),
    violation: db.prepare('UPDATE agents SET violations = violations + 1 WHERE name = ?'),
    expel: db.prepare('UPDATE agents SET expelled = 1 WHERE name = ?'),
    reputation: db.prepare('SELECT name, owner, deals, violations, expelled FROM agents ORDER BY deals DESC, violations ASC'),
    balance: db.prepare('SELECT available FROM agents WHERE name = ?'),
    setBalance: db.prepare('UPDATE agents SET available = ? WHERE name = ?'),
    setAddress: db.prepare('UPDATE agents SET address = ? WHERE name = ?'),
    setTelegram: db.prepare('UPDATE agents SET telegram = ? WHERE name = ?'),
    llave: db.prepare('SELECT custody_key AS privateKey, custody_address AS address FROM agents WHERE name = ?'),
    guardarLlave: db.prepare('UPDATE agents SET custody_key = ?, custody_address = ? WHERE name = ?'),
    nameByAddress: db.prepare('SELECT name FROM agents WHERE address = ?'),
    credit: db.prepare('INSERT OR IGNORE INTO credits (tx_hash,log_index,from_address,amount) VALUES (?,?,?,?)'),
    pendiente: db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM credits
      WHERE applied = 0 AND from_address IN (SELECT address FROM agents WHERE address IS NOT NULL)`),
    aplicar: db.prepare(`UPDATE agents SET available = COALESCE(available, 0) + (
        SELECT COALESCE(SUM(amount), 0) FROM credits WHERE from_address = agents.address AND applied = 0
      ) WHERE address IS NOT NULL`),
    marcar: db.prepare(`UPDATE credits SET applied = 1
      WHERE applied = 0 AND from_address IN (SELECT address FROM agents WHERE address IS NOT NULL)`),
    get: db.prepare('SELECT value FROM settings WHERE key = ?'),
    set: db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };

  const know = (name, owner = null) => q.agent.run(name, owner);

  return {
    // Idempotencia: el mismo trato no se liquida dos veces. Devuelve false si
    // ya estaba — el que llama NO debe volver a mover plata.
    saveDeal(d) {
      const r = q.insertDeal.run(d.id, d.buyer, d.seller, d.price, d.qty, d.total,
        d.sheet?.chainHead ?? null, JSON.stringify(d.sheet?.signatures ?? {}), d.sheet?.item ?? null, d.channel ?? null);
      if (Number(r.changes) !== 1) return false;
      for (const name of [d.buyer, d.seller]) { know(name); q.deal.run(name); }
      return true;
    },
    // Sin item: la memoria general del mercado. Con item: los comparables de
    // ese producto, que es lo único que sirve para decir si un precio es justo.
    closedPrices(limit = 50, item = null) {
      const rows = item ? q.pricesOf.all(item, limit) : q.prices.all(limit);
      return rows.map((r) => r.price);
    },
    appendEvent(session, ev) { q.event.run(session, ev.type, JSON.stringify(ev)); },

    // Lo que ESTE canal ya pagó por esto. Es el mejor comparable que existe:
    // el contexto del lugar donde se está comprando.
    channelPrices(channel, item, limit = 50) {
      if (!channel || !item) return [];
      return q.precioCanal.all(channel, item, limit).map((r) => r.price);
    },
    lastDealIn(channel, item) {
      if (!channel || !item) return null;
      return q.ultimoCanal.get(channel, item) ?? null;
    },
    recordAgent(name, owner) { know(name, owner); },
    recordViolation(name) { know(name); q.violation.run(name); },
    markExpelled(name) { know(name); q.expel.run(name); },
    reputation() { return q.reputation.all(); },

    // Catálogo: quién vende qué, dónde está y en cuánto tiempo entrega.
    placeAgent(name, { lat, lon, city, country } = {}) {
      know(name);
      q.place.run(lat ?? null, lon ?? null, city ?? null, country ?? null, name);
    },
    listSupply(seller, { item, leadDays, minPrice, source, url }) {
      know(seller);
      q.listar.run(seller, item, leadDays ?? null, minPrice ?? null, source ?? null, url ?? null);
    },
    catalog() { return q.catalogo.all(); },
    search(item) { return q.buscar.all(`%${String(item ?? '').trim()}%`); },

    saveContract(id, html, sheet) { q.guardarContrato.run(id, html, JSON.stringify(sheet)); },
    contract(id) {
      const row = q.contrato.get(id);
      return row ? { ...row, sheet: JSON.parse(row.sheet) } : null;
    },
    // El saldo es del agente, no de la sesión: reconectarse no repone lo perdido.
    balance(name) { return q.balance.get(name)?.available ?? null; },
    setBalance(name, available) { know(name); q.setBalance.run(available, name); },

    // La dirección es la identidad on-chain del agente: solo se guarda después
    // de que firmó un reto con esa llave.
    setAddress(name, address) { know(name); q.setAddress.run(address.toLowerCase(), name); },
    setTelegram(name, chatId) { know(name); q.setTelegram.run(String(chatId), name); },
    nameByAddress(address) { return q.nameByAddress.get(address.toLowerCase())?.name ?? null; },

    // Llave en custodia para quien no trae la suya (el que compra desde la web
    // no tiene wallet). Es custodia, con todo lo que eso significa.
    // ponytail: en claro en SQLite. Sirve para testnet; con plata de verdad
    // esto va cifrado en reposo o en un KMS, no en la misma tabla.
    keyOf(name) {
      const k = q.llave.get(name);
      return k?.privateKey ? k : null;
    },
    setKey(name, privateKey, address) { know(name); q.guardarLlave.run(privateKey, address, name); },

    // Un depósito es un log de la cadena. La clave es (tx, índice del log):
    // reescanear el mismo bloque mil veces acredita una sola vez.
    recordDeposit({ txHash, logIndex, from, amount }) {
      return Number(q.credit.run(txHash.toLowerCase(), logIndex, from.toLowerCase(), amount).changes) === 1;
    },

    // Acredita todo depósito cuya dirección ya tenga dueño. Lo que llegó antes
    // de que el agente se registrara se acredita cuando se registra.
    settleDeposits() {
      const total = q.pendiente.get().total;
      if (!total) return 0;
      db.exec('BEGIN');
      try { q.aplicar.run(); q.marcar.run(); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      return total;
    },

    lastBlock() { return Number(q.get.get('lastBlock')?.value ?? 0); },
    setLastBlock(n) { q.set.run('lastBlock', String(n)); },
    close() { db.close(); },
  };
}
