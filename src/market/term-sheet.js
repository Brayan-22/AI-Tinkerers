// El acta del trato: qué se firmó, exactamente.
// Cadena de hashes: cada mensaje encadena el hash del anterior, así borrar o
// editar uno rompe la cadena. Solo la cabeza se ancla on-chain — un tx por
// negociación, no uno por mensaje. El contenido vive en la base de datos.
import { createHash, randomUUID } from 'node:crypto';

export function link(prev, msg) {
  return createHash('sha256').update(`${prev}|${JSON.stringify(msg)}`).digest('hex');
}

export function termSheet({ id, item, buyer, seller, price, qty, leadDays, chainHead, closedAt }) {
  return {
    id: id ?? randomUUID(),
    item: item ?? null,
    buyer, seller, price, qty,
    leadDays: leadDays ?? null,
    total: price * qty,
    chainHead,
    closedAt: closedAt ?? Date.now(),
    signatures: {},
  };
}

// Lo que se firma. Array y no objeto: orden fijo de campos, así las dos partes
// firman exactamente los mismos bytes sin depender del orden de las claves.
export function canonical(ts) {
  return JSON.stringify([
    'mercadia/term-sheet/2',
    ts.id, ts.item, ts.buyer, ts.seller, ts.price, ts.qty, ts.leadDays, ts.total, ts.chainHead, ts.closedAt,
  ]);
}
