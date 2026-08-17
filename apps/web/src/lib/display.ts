/**
 * Traducción de dato a pintura. Vive aparte de los componentes porque la lista,
 * el marcador del mapa y el expediente tienen que colorear el mismo score
 * igual, y si cada uno lleva su propio `if` acaban divergiendo.
 *
 * Regla de color del handoff §9: nunca más colores que las tres ramas más
 * severidad. Aquí no se inventa ninguno — todo sale de los tokens.
 */

import { BRANCH_META, scoreBand, type Branch, type Severity, type Verdict } from "@borsoga/shared";

/** Color del score según tramo. Alto: marca. Medio: aviso. Bajo: neutro. */
export function scoreColor(score: number, disqualified = false): string {
  if (disqualified) return "var(--dim2)";
  switch (scoreBand(score)) {
    case "high":
      return "var(--accent)";
    case "mid":
      return "var(--warn)";
    case "low":
      return "var(--dim)";
  }
}

/** Fondo del cuadrado de score de la lista y del relleno del marcador. */
export function scoreSurface(score: number, disqualified = false): string {
  if (disqualified) return "var(--inset)";
  switch (scoreBand(score)) {
    case "high":
      return "var(--accent-soft)";
    case "mid":
      return "var(--warn-soft)";
    case "low":
      return "var(--inset)";
  }
}

/** El token de color de cada rama, ya resuelto a `var(...)`. */
export function branchColor(branch: Branch): string {
  return `var(${BRANCH_META[branch].token})`;
}

/** Severidad: crítico en `--crit`, alto y medio en `--warn`, bajo neutro. */
export function severityColor(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "var(--crit)";
    case "high":
    case "medium":
      return "var(--warn)";
    case "low":
      return "var(--dim3)";
  }
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Medio",
  low: "Bajo",
};

/** Etiqueta abreviada de veredicto para el expediente resumido. */
export const VERDICT_SHORT: Record<Verdict, string> = {
  pending: "pend.",
  confirmed: "conf.",
  nuanced: "matiz.",
  discarded: "desc.",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  nuanced: "Matizado",
  discarded: "Descartado",
};

/**
 * La capa de la evidencia. No es un detalle técnico: distingue lo que ve el
 * buscador de lo que ve el usuario, y es una regla del auditor (handoff §5).
 * `mismatch` es el caso que más vende — el sitio le enseña una cosa a Google y
 * otra a la persona.
 */
export const EVIDENCE_LAYER_LABEL: Record<string, string> = {
  served_html: "HTML servido",
  rendered_dom: "DOM renderizado",
  both_equal: "Servido y renderizado coinciden",
  mismatch: "Servido ≠ renderizado",
  external_source: "Fuente externa",
};

export const ICP_FIT_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "Encaje ICP alto",
  medium: "Encaje ICP medio",
  low: "Encaje ICP bajo",
};

/**
 * Dinero en formato corto: 48000 → "$48K". El ticket va en columnas estrechas
 * y en mono; escribirlo entero desalinea la fila.
 */
export function money(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "—";
  if (usd >= 1_000_000) {
    const m = usd / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`;
  return `$${Math.round(usd)}`;
}

/**
 * Importe exacto, para el desglose donde sí cabe.
 *
 * En en-US a propósito, aunque la interfaz esté en español: es-ES formatea el
 * dólar como "8500 US$", con el símbolo detrás, y eso desentona junto al "$9K"
 * de `money()` y rompe la alineación de las columnas en mono. El mercado es
 * Florida y el importe se lee en dólares.
 */
export function moneyExact(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);
}

/**
 * Marca de tiempo relativa en español. La cabecera muestra "hace 4 min" del
 * último escaneo; una fecha absoluta ahí no dice si el dato está fresco.
 *
 * @param now inyectable para que el render del servidor y el del cliente no
 *   discrepen por milisegundos y React no marque error de hidratación.
 */
export function timeAgo(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "hace un momento";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}
