// Cerebro mock: negociación con convergencia gradual, sin LLM.
// Misma interfaz que el cerebro Claude: (agent, view) -> { text, action, reason }.
// `reason` es la explicabilidad: por qué aceptó o rechazó, no solo el resultado.
// view: { round, minRounds, bestOffer }
export function mockBrain(agent, view) {
  const { round } = view;

  if (agent.role === 'buyer') {
    if (agent.cheat) {
      // El tramposo: promete lo que su plata no respalda. El guardián hace el resto.
      return {
        text: `Te compro todo a $999 la unidad. Cierro ya, confía en mí.`,
        action: { type: 'offer', price: 999, qty: agent.qty },
        reason: 'prometo más de lo que tengo: si nadie valida el escrow, me llevo la mercancía gratis',
      };
    }
    // naive: agente débil que sube rápido y paga de más — la víctima de Project Deal
    const start = Math.round(agent.maxPrice * (agent.naive ? 0.8 : 0.84));
    const step = agent.naive ? 4 : 2;
    const price = Math.min(agent.maxPrice, start + (round - 1) * step);
    const text = round === 1
      ? `Necesito ${agent.qty} unidades. Ofrezco $${price} cada una, cierro ahora mismo.`
      : agent.naive ? `Bueno, $${price}. La verdad las necesito urgente.` : `$${price}. Y te compro más el mes que viene.`;
    return {
      text,
      action: { type: 'offer', price, qty: agent.qty },
      reason: `techo $${agent.maxPrice}; concedo $${step} por ronda y voy en $${price}`,
    };
  }

  // greedy: agente fuerte que huele la urgencia y no cede casi nada
  const ask = Math.max(agent.minPrice, Math.round(agent.minPrice * (agent.greedy ? 1.1 : 1.17)) - (round - 1) * (agent.greedy ? 1 : 2));
  const best = view.bestOffer;
  if (best && round >= view.minRounds && best.price >= Math.max(agent.minPrice, ask - 1)) {
    return {
      text: `Hecho a $${best.price} por el volumen. Trato.`,
      action: { type: 'accept', offerId: best.id },
      reason: `$${best.price} cubre mi piso de $${agent.minPrice} y ya pasó la ronda mínima`,
    };
  }
  const text = best
    ? `$${best.price} no me da margen. $${ask} y son tuyas hoy.`
    : `Estoy vendiendo a $${ask} la unidad.`;
  return {
    text,
    action: { type: 'quote', price: ask, qty: agent.qty },
    reason: best
      ? `$${best.price} está por debajo de mi piso de $${agent.minPrice}; contraoferto $${ask}`
      : `abro en $${ask} con piso $${agent.minPrice}`,
  };
}

// El comprador pidiendo cotización: pregunta y regatea, nunca oferta. Ofertar
// compromete plata, y en esta fase todavía no eligió proveedor.
export function askBrain(agent, view) {
  const q = view.lastQuote;
  if (!q) {
    return {
      text: `Necesito ${agent.qty} de ${view.item}. Entrega máximo en ${agent.maxLeadDays} días. ¿En cuánto me lo dejas?`,
      reason: `abro cotización: ${agent.qty} unidades, plazo máximo ${agent.maxLeadDays} días`,
      action: { type: 'talk' },
    };
  }
  const objetivo = Math.max(1, Math.round(q.price * 0.9));
  return {
    text: `$${q.price} me queda alto y tengo otras cotizaciones sobre la mesa. ¿$${objetivo}?`,
    reason: `regateo pidiendo 10% menos de $${q.price}: estoy comparando con otros proveedores`,
    action: { type: 'talk' },
  };
}

// El proveedor: cotiza precio y plazo, cede de a poco por ronda. Si ya le
// pusieron una oferta firme que cubre su piso, la toma.
export function supplierBrain(agent, view) {
  const best = view.bestOffer;
  if (best && best.price >= agent.minPrice && view.round >= view.minRounds) {
    return {
      text: `Hecho. ${best.qty} unidades a $${best.price}, despacho en ${agent.leadDays} días.`,
      action: { type: 'accept', offerId: best.id },
      reason: `$${best.price} cubre mi piso de $${agent.minPrice}`,
    };
  }
  const ask = Math.max(agent.minPrice, Math.round(agent.minPrice * 1.18) - (view.round - 1) * 2);
  return {
    text: `Te dejo ${view.item ?? 'el pedido'} a $${ask} la unidad, entrega en ${agent.leadDays} días.`,
    action: { type: 'quote', price: ask, qty: agent.qty, leadDays: agent.leadDays },
    reason: `mi piso es $${agent.minPrice}; cotizo $${ask} y bajo $2 por ronda mientras negociamos`,
  };
}
