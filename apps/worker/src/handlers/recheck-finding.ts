/**
 * `finding.recheck`: mirar otra vez un solo hallazgo.
 *
 * Lo encola la interfaz cuando alguien pulsa "Reverificar con IA". El orden es
 * el mismo que en la auditoría y por el mismo motivo: primero la traza, después
 * la evidencia resuelta contra las observaciones reales del run, y solo entonces
 * se toca el hallazgo. Si el agente no entrega nada utilizable, el hallazgo se
 * queda exactamente como estaba.
 *
 * Lo que este handler NO hace es emitir un veredicto. La web ya devolvió el
 * hallazgo a `pending` al encolar; aquí se refresca la prueba y el texto, y
 * quien decide sigue siendo una persona (handoff §5).
 */

import { desc, eq } from "drizzle-orm";
import {
  db,
  evidence as evidenceTable,
  findings as findingsTable,
  prospects,
  scans,
} from "@borsoga/db";
import {
  recheckOutputJsonSchema,
  recheckOutputSchema,
  resolveEvidence,
  type AgentToolCall,
  type AgentToolContext,
} from "@borsoga/shared";
import { config } from "../config";
import { errorMessage, log } from "../log";
import { waitTurn } from "../net/politeness";
import { recordStep, recordToolCall } from "../persist/trace";
import { recheckPrompt, recheckSystem } from "../prompts";
import { getProvider } from "../providers";
import { auditorTools } from "../tools";

export interface RecheckFindingPayload {
  findingId: string;
  prospectId: string;
}

export async function recheckFinding(
  payload: RecheckFindingPayload,
  signal: AbortSignal,
): Promise<void> {
  const { findingId } = payload;

  const [row] = await db
    .select({
      finding: findingsTable,
      evidence: evidenceTable,
      prospect: prospects,
    })
    .from(findingsTable)
    .innerJoin(evidenceTable, eq(findingsTable.evidenceId, evidenceTable.id))
    .innerJoin(prospects, eq(findingsTable.prospectId, prospects.id))
    .where(eq(findingsTable.id, findingId))
    .limit(1);

  if (!row) throw new Error(`hallazgo ${findingId} no existe`);
  const { finding, evidence, prospect } = row;

  /*
   * La traza cuelga de un escaneo (`trace_steps.scan_id` es NOT NULL), y una
   * reverificación no es un escaneo nuevo: se cuelga del último de su zona, que
   * es el contexto en el que ese prospecto se encontró. Crear una fila de
   * `scans` por cada reverificación llenaría de ruido la vista de Zonas.
   */
  const [lastScan] = await db
    .select({ id: scans.id })
    .from(scans)
    .where(eq(scans.zoneId, prospect.zoneId))
    .orderBy(desc(scans.startedAt))
    .limit(1);

  if (!lastScan) throw new Error(`la zona de ${prospect.name} no tiene ningún escaneo`);
  const scanId = lastScan.id;

  log.info("reverificando", { prospect: prospect.name, finding: finding.title });

  const ctx: AgentToolContext = {
    scanId,
    prospectId: prospect.id,
    signal,
    rateLimit: waitTurn,
  };

  const stepByObservation = new Map<string, string>();
  const pendingWrites: Promise<void>[] = [];

  const onStep = (call: AgentToolCall): void => {
    pendingWrites.push(
      recordToolCall({ scanId, prospectId: prospect.id, call })
        .then(({ traceStepId, observationIds }) => {
          for (const id of observationIds) stepByObservation.set(id, traceStepId);
        })
        .catch((err) => log.error("no se pudo escribir el paso", { err: errorMessage(err) })),
    );
  };

  const startedAt = new Date();
  const t0 = performance.now();

  const run = await getProvider().runAgent({
    system: recheckSystem,
    prompt: recheckPrompt({
      prospectName: prospect.name,
      website: prospect.website,
      evidenceUrl: evidence.url,
      branch: finding.branch,
      title: finding.title,
      description: finding.description,
      previousQuote: evidence.quote,
      verifiedAt: finding.verifiedAt,
    }),
    tools: auditorTools as never,
    ctx,
    schemaName: "RecheckOutput",
    schema: recheckOutputJsonSchema,
    maxTurns: config.LLM_MAX_TURNS,
    maxCostUsd: config.LLM_MAX_COST_USD_PER_PROSPECT,
    onStep,
  });

  await Promise.all(pendingWrites);

  const runStepId = await recordStep({
    scanId,
    prospectId: prospect.id,
    step: "finding.recheck",
    target: finding.title,
    status: run.stopReason === "completed" ? "ok" : "error",
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    model: run.model,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    input: { findingId, url: evidence.url },
    output: {
      stopReason: run.stopReason,
      turns: run.turns,
      toolCalls: run.toolCalls.length,
    },
  });

  if (run.stopReason !== "completed" || run.json === null) {
    throw new Error(`el agente no entregó reverificación (${run.stopReason})`);
  }

  const parsed = recheckOutputSchema.safeParse(run.json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`reverificación inválida: ${issues.join("; ")}`);
  }
  const result = parsed.data;

  const resolved = resolveEvidence(run, result.evidenceRef, result.additionalEvidenceRefs ?? []);
  if (!resolved) {
    // Misma regla que en la auditoría: sin observación real no se escribe nada.
    throw new Error(`la reverificación citó una evidencia inexistente (${result.evidenceRef})`);
  }

  const traceStepId = stepByObservation.get(resolved.id) ?? null;

  const [evidenceRow] = await db
    .insert(evidenceTable)
    .values({
      prospectId: prospect.id,
      traceStepId,
      url: resolved.url,
      quote: resolved.quote,
      layer: resolved.layer,
      method: resolved.method,
      capturedAt: new Date(resolved.capturedAt),
      screenshotStorageKey: resolved.screenshot?.storageKey ?? null,
      screenshotWidth: resolved.screenshot?.width ?? null,
      screenshotHeight: resolved.screenshot?.height ?? null,
      screenshotTakenAt: resolved.screenshot ? new Date(resolved.screenshot.takenAt) : null,
      additionalSources: (resolved.additionalSources ?? []) as never,
    })
    .returning({ id: evidenceTable.id });

  if (!evidenceRow) throw new Error("no se pudo escribir la evidencia de la reverificación");

  await db
    .update(findingsTable)
    .set({
      evidenceId: evidenceRow.id,
      title: result.title,
      description: result.description,
      clientGain: result.clientGain,
      severity: result.severity,
      verifiedAt: new Date(),
      traceStepId: traceStepId ?? runStepId,
      /*
       * Si el agente dice que ya no se sostiene, el hallazgo deja de entrar en
       * propuestas — pero sigue `pending` y visible. Descartarlo es una decisión
       * humana, y borrarlo de la vista escondería justo el caso que hay que
       * mirar: algo que la IA afirmó y luego se desdijo.
       */
      excludedFromProposal: !result.stillHolds,
    })
    .where(eq(findingsTable.id, findingId));

  log.info("reverificado", {
    finding: result.title,
    seSostiene: result.stillHolds,
    razon: result.reasoning.slice(0, 120),
  });
}
