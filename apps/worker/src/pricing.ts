/**
 * Estimación de ticket por rama.
 *
 * ⚠️ Los importes son un marcador de posición, no la tarifa de Borsoga. El
 * handoff no incluye lista de precios y esto es una decisión comercial, no de
 * implementación: sustitúyelos por los reales antes de enseñar una cifra a
 * nadie de fuera. Están aquí y no repartidos justamente para que cambiarlos sea
 * editar cinco números.
 *
 * El cálculo sí es deliberado: el ticket sale del score de la rama, porque un
 * problema más grave es más trabajo. Va de la mitad del importe base cuando la
 * rama apenas puntúa a una vez y media cuando está saturada.
 */

import { BRANCHES, type Branch } from "@borsoga/shared";

export const BASE_TICKET_USD: Record<Branch, number> = {
  renders: 8_000,
  web: 14_000,
  branding: 10_000,
};

/** Redondeo a 500 USD: una estimación al dólar finge una precisión que no hay. */
function roundTicket(value: number): number {
  return Math.round(value / 500) * 500;
}

export function branchTicket(branch: Branch, branchScore: number): number {
  if (branchScore <= 0) return 0;
  return roundTicket(BASE_TICKET_USD[branch] * (0.5 + branchScore / 100));
}

export function branchTickets(scores: Record<Branch, number>): Record<Branch, number> {
  return {
    renders: branchTicket("renders", scores.renders),
    web: branchTicket("web", scores.web),
    branding: branchTicket("branding", scores.branding),
  };
}

/** Ticket total: la suma de las ramas con hallazgos. */
export function ticketEstimate(scores: Record<Branch, number>): number {
  return BRANCHES.reduce((sum, b) => sum + branchTicket(b, scores[b]), 0);
}
