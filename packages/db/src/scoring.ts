/**
 * Recalcular el score de un prospecto a partir de sus hallazgos.
 *
 * Vive aquí, en `db`, y no en la web ni en el worker, porque los dos cambian
 * hallazgos y los dos tienen que recalcular después:
 *
 * - la web, cuando un humano confirma, matiza o descarta en la cola de revisión;
 * - el worker, cuando una reverificación cambia la severidad de un hallazgo.
 *
 * La primera versión solo lo tenía la web, y el fallo apareció en cuanto se
 * ejecutó el worker de verdad: una reverificación subió una severidad de
 * `medium` a `high` y el score se quedó en el valor viejo, así que el mapa
 * seguía pintando el marcador con el color de antes. Cualquier escritura sobre
 * `findings` que no llame a esto deja la lista y el mapa mintiendo.
 */

import { eq } from "drizzle-orm";
import {
  branchTickets,
  ticketEstimate,
  totalScore,
  type ScorableFinding,
} from "@borsoga/shared";
import type { Db } from "./client";
import { findings, prospects } from "./schema";

/** Cómo pesa el encaje de ICP en el score total. */
export const ICP_FIT_SCORE = { high: 100, medium: 60, low: 25 } as const;

export async function recomputeProspectScore(db: Db, prospectId: string): Promise<void> {
  const [prospect] = await db
    .select({ icpFit: prospects.icpFit })
    .from(prospects)
    .where(eq(prospects.id, prospectId))
    .limit(1);

  if (!prospect) return;

  const rows = await db
    .select({
      branch: findings.branch,
      severity: findings.severity,
      verdict: findings.verdict,
    })
    .from(findings)
    .where(eq(findings.prospectId, prospectId));

  const scored = totalScore(rows as ScorableFinding[], ICP_FIT_SCORE[prospect.icpFit]);
  const tickets = branchTickets(scored.branchScores);

  await db
    .update(prospects)
    .set({
      score: scored.score,
      branchScores: scored.branchScores as never,
      branchTickets: tickets as never,
      ticketEstimate: ticketEstimate(scored.branchScores),
      scoreFactors: scored.factors as never,
    })
    .where(eq(prospects.id, prospectId));
}
