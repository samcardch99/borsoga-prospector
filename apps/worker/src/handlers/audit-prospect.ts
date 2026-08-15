/**
 * `audit.prospect`: un run del agente sobre un negocio.
 *
 * El orden importa. Primero se escribe la traza (para poder depurar aunque lo
 * demás falle), después se resuelve la evidencia contra las observaciones
 * reales del run, y solo entonces se persisten los hallazgos. Un hallazgo cuyo
 * `evidenceRef` no case con nada que una herramienta viera no llega a la base
 * de datos: se cuenta y se descarta.
 */

import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import {
  db,
  evidence as evidenceTable,
  findings as findingsTable,
  prospects,
  scans,
  zones,
} from "@borsoga/db";
import {
  auditorOutputJsonSchema,
  auditorOutputSchema,
  resolveEvidence,
  totalScore,
  type AgentToolCall,
  type AgentToolContext,
  type Branch,
  type ScorableFinding,
  type Severity,
  type Verdict,
} from "@borsoga/shared";
import { config } from "../config";
import { errorMessage, log } from "../log";
import { waitTurn } from "../net/politeness";
import { recordStep, recordToolCall } from "../persist/trace";
import { branchTickets, ticketEstimate } from "../pricing";
import { auditorPrompt, auditorSystem } from "../prompts";
import { getProvider } from "../providers";
import { auditorTools } from "../tools";

export interface AuditProspectPayload {
  scanId: string;
  prospectId: string;
}

const ICP_FIT_SCORE = { high: 100, medium: 60, low: 25 } as const;

export async function auditProspect(
  payload: AuditProspectPayload,
  signal: AbortSignal,
): Promise<void> {
  const { scanId, prospectId } = payload;

  const [row] = await db
    .select({
      prospect: prospects,
      zoneName: zones.name,
    })
    .from(prospects)
    .innerJoin(zones, eq(prospects.zoneId, zones.id))
    .where(eq(prospects.id, prospectId))
    .limit(1);

  if (!row) throw new Error(`prospecto ${prospectId} no existe`);
  const { prospect } = row;

  log.info("auditando", { prospect: prospect.name, scanId });

  // ─── El run ────────────────────────────────────────────────────────────────

  const ctx: AgentToolContext = {
    scanId,
    prospectId,
    signal,
    rateLimit: waitTurn,
  };

  /** obsId → traceStepId. Se llena en vivo, según el agente va mirando. */
  const stepByObservation = new Map<string, string>();
  const pendingWrites: Promise<void>[] = [];

  const onStep = (call: AgentToolCall): void => {
    pendingWrites.push(
      recordToolCall({ scanId, prospectId, call })
        .then(({ traceStepId, observationIds }) => {
          for (const id of observationIds) stepByObservation.set(id, traceStepId);
        })
        .catch((err) => log.error("no se pudo escribir el paso", { err: errorMessage(err) })),
    );
  };

  const startedAt = new Date();
  const t0 = performance.now();

  const run = await getProvider().runAgent({
    system: auditorSystem,
    prompt: auditorPrompt({
      name: prospect.name,
      placeId: prospect.placeId,
      address: prospect.address,
      city: prospect.city,
      website: prospect.website,
      phone: prospect.phone,
      sectorHints: prospect.sectors,
      zoneName: row.zoneName,
    }),
    tools: auditorTools as never,
    ctx,
    schemaName: "AuditorOutput",
    schema: auditorOutputJsonSchema,
    maxTurns: config.LLM_MAX_TURNS,
    maxCostUsd: config.LLM_MAX_COST_USD_PER_PROSPECT,
    onStep,
  });

  await Promise.all(pendingWrites);

  const runStepId = await recordStep({
    scanId,
    prospectId,
    step: "audit.run",
    target: prospect.name,
    status: run.stopReason === "completed" ? "ok" : "error",
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    model: run.model,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    input: { placeId: prospect.placeId, website: prospect.website },
    output: {
      stopReason: run.stopReason,
      turns: run.turns,
      toolCalls: run.toolCalls.length,
      observations: run.observations.size,
    },
  });

  const failedCalls = run.toolCalls.filter((c) => !c.ok).length;

  if (run.stopReason !== "completed" || run.json === null) {
    await bumpScanTotals(scanId, {
      steps: run.toolCalls.length + 1,
      tokens: run.tokensIn + run.tokensOut,
      costUsd: run.costUsd,
      errors: failedCalls + 1,
    });
    throw new Error(`el agente no entregó informe (${run.stopReason})`);
  }

  // ─── Validación ────────────────────────────────────────────────────────────

  const parsed = auditorOutputSchema.safeParse(run.json);
  if (!parsed.success) {
    await bumpScanTotals(scanId, {
      steps: run.toolCalls.length + 1,
      tokens: run.tokensIn + run.tokensOut,
      costUsd: run.costUsd,
      errors: failedCalls + 1,
    });
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`informe inválido: ${issues.join("; ")}`);
  }
  const report = parsed.data;

  // ─── Evidencia y hallazgos ─────────────────────────────────────────────────

  await db
    .delete(findingsTable)
    .where(
      and(
        eq(findingsTable.prospectId, prospectId),
        eq(findingsTable.verdict, "pending"),
        isNull(findingsTable.reviewedBy),
      ),
    );

  await db.delete(evidenceTable).where(
    and(
      eq(evidenceTable.prospectId, prospectId),
      notExists(
        db
          .select({ one: sql`1` })
          .from(findingsTable)
          .where(eq(findingsTable.evidenceId, evidenceTable.id)),
      ),
    ),
  );

  const stored: ScorableFinding[] = [];
  let orphaned = 0;

  for (const finding of report.findings) {
    const resolved = resolveEvidence(run, finding.evidenceRef, finding.additionalEvidenceRefs ?? []);

    if (!resolved) {
      orphaned += 1;
      log.warn("hallazgo sin evidencia real, descartado", {
        title: finding.title,
        ref: finding.evidenceRef,
      });
      continue;
    }

    const traceStepId = stepByObservation.get(resolved.id) ?? null;

    const [evidenceRow] = await db
      .insert(evidenceTable)
      .values({
        prospectId,
        traceStepId,
        url: resolved.url,
        quote: resolved.quote,
        layer: resolved.layer,
        method: resolved.method,
        capturedAt: new Date(resolved.capturedAt),
        screenshotStorageKey: resolved.screenshot?.storageKey ?? null,
        screenshotWidth: resolved.screenshot?.width ?? null,
        screenshotHeight: resolved.screenshot?.height ?? null,
        screenshotTakenAt: resolved.screenshot
          ? new Date(resolved.screenshot.takenAt)
          : null,
        additionalSources: (resolved.additionalSources ?? []) as never,
      })
      .returning({ id: evidenceTable.id });

    if (!evidenceRow) throw new Error("no se pudo escribir la evidencia");

    await db.insert(findingsTable).values({
      prospectId,
      evidenceId: evidenceRow.id,
      branch: finding.branch,
      severity: finding.severity,
      verdict: finding.verdict,
      title: finding.title,
      description: finding.description,
      clientGain: finding.clientGain,
      traceStepId: traceStepId ?? runStepId,
    });

    stored.push({
      branch: finding.branch as Branch,
      severity: finding.severity as Severity,
      verdict: finding.verdict as Verdict,
    });
  }

  if (orphaned > 0) {
    log.warn("hallazgos descartados por evidencia inexistente", { orphaned, prospectId });
  }

  // ─── Score y ficha ─────────────────────────────────────────────────────────

  const scored = totalScore(stored, ICP_FIT_SCORE[report.icpFit]);
  const tickets = branchTickets(scored.branchScores);

  await db
    .update(prospects)
    .set({
      name: report.company.name || prospect.name,
      sectors: report.company.sectors,
      website: report.company.website ?? prospect.website,
      ratings: report.company.ratings as never,
      score: scored.score,
      branchScores: scored.branchScores as never,
      branchTickets: tickets as never,
      ticketEstimate: ticketEstimate(scored.branchScores),
      scoreFactors: scored.factors as never,
      icpFit: report.icpFit,
      disqualified: report.disqualified,
      disqualifyReason: report.disqualifyReason,
      commercialViability: report.commercialViability,
      lastScannedAt: new Date(),
    })
    .where(eq(prospects.id, prospectId));

  await bumpScanTotals(scanId, {
    steps: run.toolCalls.length + 1,
    tokens: run.tokensIn + run.tokensOut,
    costUsd: run.costUsd,
    errors: failedCalls,
    audited: 1,
    disqualified: report.disqualified ? 1 : 0,
  });

  await closeScanIfDone(scanId);

  log.info("auditado", {
    prospect: prospect.name,
    score: scored.score,
    hallazgos: stored.length,
    descartados: orphaned,
    coste: run.costUsd.toFixed(4),
  });
}

// ─── Contadores del escaneo ──────────────────────────────────────────────────

async function bumpScanTotals(
  scanId: string,
  delta: {
    steps: number;
    tokens: number;
    costUsd: number;
    errors: number;
    audited?: number;
    disqualified?: number;
  },
): Promise<void> {
  await db
    .update(scans)
    .set({
      totalSteps: sql`${scans.totalSteps} + ${delta.steps}`,
      totalTokens: sql`${scans.totalTokens} + ${delta.tokens}`,
      totalCostUsd: sql`${scans.totalCostUsd} + ${delta.costUsd}`,
      totalErrors: sql`${scans.totalErrors} + ${delta.errors}`,
      progressAudited: sql`${scans.progressAudited} + ${delta.audited ?? 0}`,
      progressDisqualified: sql`${scans.progressDisqualified} + ${delta.disqualified ?? 0}`,
    })
    .where(eq(scans.id, scanId));
}

/** El escaneo termina cuando termina la última auditoría, no la búsqueda. */
async function closeScanIfDone(scanId: string): Promise<void> {
  await db
    .update(scans)
    .set({ status: "completed", finishedAt: new Date() })
    .where(
      and(
        eq(scans.id, scanId),
        eq(scans.status, "running"),
        sql`${scans.progressAudited} >= ${scans.progressTotal}`,
      ),
    );
}
