/**
 * Criterio de ICP. Con el enfoque agéntico esto NO es un filtro que corra antes
 * del agente y le recorte candidatos: es el criterio que el agente recibe en su
 * prompt y aplica con juicio, y que la interfaz usa para explicar por qué algo
 * quedó dentro o fuera.
 *
 * Por eso vive como dato declarativo y no como una función de filtrado: lo lee
 * el prompt del auditor, lo leen los chips de filtro de la lista, y lo lee el
 * estado vacío cuando tiene que desglosar por qué 34 negocios quedaron fuera.
 */

import type { County, DisqualifyReason, Sector } from "./types";

export const ICP = {
  counties: ["miami_dade", "broward", "palm_beach"] as const satisfies readonly County[],

  sectors: [
    "construction",
    "remodeling",
    "real_estate_development",
    "modular_homes",
    "closets",
    "kitchens",
    "millwork",
    "cabinetry",
    "interior_design",
  ] as const satisfies readonly Sector[],

  employees: { min: 10, max: 200 },

  /** Proyectos por debajo de esto no pagan el trabajo de Borsoga. */
  minProjectUsd: 20_000,

  /** Se describen en prosa porque el agente los juzga, no los compara. */
  requires: [
    "empresa independiente, no franquicia nacional",
    "producto real y propio, no reventa ni intermediación",
    "buena reputación: sin patrón de reseñas negativas sin responder",
  ],

  excludes: [
    "franquicias nacionales",
    "empresas con agencia interna o equipo de marketing propio",
    "más de ~200 empleados",
    "negocios sin web ni producto propio",
    "clientes actuales de Borsoga",
  ],
} as const;

/** Etiqueta legible del motivo de descarte. Se muestra en gris junto al prospecto. */
export const DISQUALIFY_LABEL: Record<DisqualifyReason, string> = {
  national_franchise: "Franquicia nacional",
  has_in_house_agency: "Tiene agencia interna",
  too_large: "Demasiado grande",
  no_own_product: "Sin producto propio",
  no_website_no_product: "Sin web ni producto",
  ticket_too_low: "Ticket por debajo del mínimo",
  out_of_area: "Fuera del área",
  already_client: "Ya es cliente",
  manual: "Descartado a mano",
};

export const SECTOR_LABEL: Record<Sector, string> = {
  construction: "Construcción",
  remodeling: "Remodelación",
  real_estate_development: "Desarrollo inmobiliario",
  modular_homes: "Casas modulares",
  closets: "Closets",
  kitchens: "Cocinas",
  millwork: "Millwork",
  cabinetry: "Cabinetry",
  interior_design: "Interiorismo",
};

export const COUNTY_LABEL: Record<County, string> = {
  miami_dade: "Miami-Dade",
  broward: "Broward",
  palm_beach: "Palm Beach",
};

/** Las tres ramas, con la letra que usan las insignias de la lista y su token. */
export const BRANCH_META = {
  renders: { letter: "R", label: "Visualización arquitectónica", token: "--b1" },
  web: { letter: "W", label: "Web", token: "--accent" },
  branding: { letter: "B", label: "Branding", token: "--b3" },
} as const;
