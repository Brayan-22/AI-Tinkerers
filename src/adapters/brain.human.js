// Un proveedor de carne y hueso como cerebro de negociación.
//
// Misma interfaz que cualquier otro cerebro: (agent, view) -> {text, action}.
// Por dentro le escribe a una persona y espera su respuesta en texto libre.
// El dominio no distingue entre este y un modelo: el guardián valida igual.
import { extraerCotizacion } from './brain.llm.js';

const SI = /\b(s[íi]|dale|listo|ok|okey|dele|hecho|dale pues|dalee|de acuerdo|cerramos|acepto|vale)\b/i;

export function humanBrain(canal, chatId, { timeoutMs = 120_000, qty, comprador } = {}) {
  // Lo que esta persona cotizó, para no volver a preguntarle lo mismo.
  let cotizado = null;

  return async (agent, view) => {
    const cantidad = qty ?? agent.qty;
    const firme = view.bestOffer;

    // Ya hay una oferta firme sobre la mesa. Si cubre lo que pidió, se cierra
    // sin molestarlo: él puso el precio y le están pagando ese precio.
    if (firme && cotizado && firme.price >= cotizado) {
      await canal.decir(chatId, `✅ Cerrado: *${firme.qty} × ${view.item}* a $${firme.price} la unidad, como cotizaste. Te llega el contrato firmado.`);
      return {
        text: `Cerrado a $${firme.price}.`,
        reason: `acepto: $${firme.price} es el precio que yo mismo cotizé`,
        action: { type: 'accept', offerId: firme.id },
      };
    }

    // Hay oferta firme pero por debajo de lo que pidió: se le pregunta.
    if (firme) {
      await canal.decir(chatId, `Te ofrecen $${firme.price} la unidad por ${firme.qty} de *${view.item}*. ¿Lo tomas? (sí / no)`);
      const r = await canal.esperar(chatId, timeoutMs);
      if (r && SI.test(r)) {
        return { text: r, reason: 'la persona aceptó la oferta por debajo de su cotización', action: { type: 'accept', offerId: firme.id } };
      }
      return { text: r ?? '(no contestó)', reason: 'no aceptó la oferta', action: { type: 'talk' } };
    }

    const pregunta = view.lastQuote && view.round > 1
      ? `Tengo otras cotizaciones más bajas que $${view.lastQuote.price}. ¿Me lo mejoras y cerramos?`
      : `Hola 👋 Soy el agente de compras de *${comprador ?? 'un cliente'}*.\n\n`
        + `Necesito *${cantidad}* de *${view.item}*.\n`
        + `¿A cómo la unidad y en cuántos días entregas?\n\n`
        + `_Contesta normal, por ejemplo: "a $1.200 cada uno, en 2 días"._`;

    await canal.decir(chatId, pregunta);
    const respuesta = await canal.esperar(chatId, timeoutMs);

    if (!respuesta) {
      return { text: '(no contestó a tiempo)', reason: 'el proveedor no respondió dentro del plazo', action: { type: 'talk' } };
    }

    const c = await extraerCotizacion(respuesta);
    if (c.rechaza || !c.price) {
      return { text: respuesta, reason: c.rechaza ? 'dice que no tiene' : 'contestó sin dar precio', action: { type: 'talk' } };
    }

    cotizado = c.price;
    return {
      text: respuesta,
      reason: `cotización de una persona real, leída de su mensaje (${c.via ?? 'reglas'})`,
      action: { type: 'quote', price: c.price, qty: cantidad, leadDays: c.leadDays ?? agent.leadDays ?? 7 },
    };
  };
}
