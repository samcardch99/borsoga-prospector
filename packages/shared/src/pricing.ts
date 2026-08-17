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
 *
 * Vive en `shared` y no en el worker porque el score se recalcula en dos sitios:
 * cuando el agente audita y cuando un humano cambia un veredicto en la cola de
 * revisión. Dos copias de esta tabla darían dos tickets distintos para el mismo
 * prospecto según quién tocó el dato el último.
 */

import { BRANCHES } from "./scoring";
import type { Branch } from "./types";

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

/**
 * Las fases por defecto de una propuesta, una por rama.
 *
 * ⚠️ Mismo aviso que los importes: los entregables y los plazos son un marcador
 * de posición razonable, no el catálogo de servicios de Borsoga. El handoff no
 * lo incluye porque es una decisión comercial. Están aquí, junto a los precios,
 * para que revisarlos sea abrir un archivo.
 *
 * El precio no vive aquí: sale de `branchTicket()` con el score real de la
 * rama, porque un problema más grave es más trabajo.
 */
export const PHASE_TEMPLATE: Record<
  Branch,
  { name: string; deliverables: string[]; weeks: string }
> = {
  renders: {
    name: "Visualización arquitectónica",
    deliverables: [
      "Renders de tres piezas del portfolio, en interior y exterior",
      "Tratamiento de luz natural y materiales fieles al proyecto",
      "Entrega en alta resolución y en versión optimizada para web",
    ],
    weeks: "3–4 semanas",
  },
  web: {
    name: "Web y presencia técnica",
    deliverables: [
      "Corrección de lo que el buscador no ve del sitio actual",
      "Rehecho de la parrilla de proyectos con texto alternativo real",
      "Navegación móvil completa y formulario de contacto comprobado",
    ],
    weeks: "4–6 semanas",
  },
  branding: {
    name: "Identidad",
    deliverables: [
      "Revisión de identidad aplicada a los soportes que ya se usan",
      "Sistema tipográfico y de color con sus reglas de uso",
      "Plantillas de propuesta y de ficha de proyecto",
    ],
    weeks: "3–5 semanas",
  },
};
