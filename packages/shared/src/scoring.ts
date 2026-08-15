/**
 * Cálculo del score. Los pesos son la propuesta del handoff §5 y están puestos
 * para ajustarse con datos reales — por eso viven aquí y no repartidos.
 *
 * Regla: guarda siempre `scoreFactors`. Un número sin explicación no se puede
 * discutir con el equipo comercial, y la interfaz lo muestra desglosado.
 */

import type { Branch, Finding, Severity, Verdict } from "./types";

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  high: 6,
  medium: 3,
  low: 1,
};

export const VERDICT_FACTOR: Record<Verdict, number> = {
  confirmed: 1,
  nuanced: 0.6,
  pending: 0.5,
  discarded: 0,
};

/** Divisor que satura el score de rama. ~2,4 hallazgos críticos confirmados. */
export const BRANCH_SATURATION = 24;

export const TOTAL_WEIGHTS = {
  topBranch: 0.45,
  secondBranch: 0.35,
  icpFit: 0.2,
} as const;

export const BRANCHES: readonly Branch[] = ["renders", "web", "branding"];

export interface ScoreFactor {
  label: string;
  weight: number;
  value: number;
}

/**
 * Lo único que el score mira de un hallazgo. Se pide esto y no un `Finding`
 * entero para poder puntuar lo que acaba de devolver el agente, antes de que
 * tenga id ni fecha de detección.
 */
export type ScorableFinding = Pick<Finding, "branch" | "severity" | "verdict">;

/** Score de una rama, 0–100, a partir de sus hallazgos. */
export function branchScore(findings: readonly ScorableFinding[]): number {
  const raw = findings.reduce(
    (sum, f) => sum + SEVERITY_WEIGHT[f.severity] * VERDICT_FACTOR[f.verdict],
    0,
  );
  return Math.min(100, Math.round((100 * raw) / BRANCH_SATURATION));
}

/** Score por rama para los tres valores de `Branch`, incluidas las vacías. */
export function branchScores(
  findings: readonly ScorableFinding[],
): Record<Branch, number> {
  return {
    renders: branchScore(findings.filter((f) => f.branch === "renders")),
    web: branchScore(findings.filter((f) => f.branch === "web")),
    branding: branchScore(findings.filter((f) => f.branch === "branding")),
  };
}

export interface TotalScoreResult {
  score: number;
  branchScores: Record<Branch, number>;
  factors: ScoreFactor[];
}

/**
 * Score total ponderado. No es un número plano: dos prospectos de 80 se venden
 * distinto según de qué rama venga su 80, así que se devuelve el desglose.
 *
 * @param icpFitScore 0–100, de tamaño, sector, ticket, reputación y crecimiento.
 */
export function totalScore(
  findings: readonly ScorableFinding[],
  icpFitScore: number,
): TotalScoreResult {
  const perBranch = branchScores(findings);

  const ranked = BRANCHES.map((branch) => ({ branch, value: perBranch[branch] })).sort(
    (a, b) => b.value - a.value,
  );

  const top = ranked[0] ?? { branch: "web" as Branch, value: 0 };
  const second = ranked[1] ?? { branch: "web" as Branch, value: 0 };

  const factors: ScoreFactor[] = [
    { label: `Rama principal (${top.branch})`, weight: TOTAL_WEIGHTS.topBranch, value: top.value },
    { label: `Segunda rama (${second.branch})`, weight: TOTAL_WEIGHTS.secondBranch, value: second.value },
    { label: "Encaje ICP", weight: TOTAL_WEIGHTS.icpFit, value: icpFitScore },
  ];

  const score = Math.round(
    factors.reduce((sum, f) => sum + f.weight * f.value, 0),
  );

  return { score, branchScores: perBranch, factors };
}

/** Tramo de color del marcador y del cuadrado de score en la lista. */
export type ScoreBand = "high" | "mid" | "low";

export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return "high";
  if (score >= 45) return "mid";
  return "low";
}
