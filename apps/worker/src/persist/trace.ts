/**
 * Persistencia de la Traza.
 *
 * Con el enfoque agéntico cada fila es una llamada a herramienta que la IA
 * decidió hacer, no un paso de un pipeline. Se escribe en cuanto ocurre para
 * que la vista se actualice en vivo, y devuelve el id del paso para poder
 * colgar de él la evidencia que produjo.
 */

import { db, traceSteps } from "@borsoga/db";
import type { AgentToolCall, TraceStatus } from "@borsoga/shared";
import { config } from "../config";
import { clip } from "../tools/observation";

/** Códigos de las herramientas → estados que la vista de Traza sabe colorear. */
function statusFor(call: AgentToolCall): TraceStatus {
  if (call.ok) return "ok";
  switch (call.errorCode) {
    case "ROBOTS_DISALLOWED":
      return "skipped";
    case "HTTP_404":
      return "http_404";
    case "OVER_QUERY_LIMIT":
      return "retry";
    default:
      return call.errorCode?.includes("TIMEOUT") ? "timeout" : "error";
  }
}

/** Objetivo legible: es la columna que se lee de un vistazo en la tabla. */
function targetFor(call: AgentToolCall): string {
  const input = call.input as Record<string, unknown> | null;
  const raw =
    (typeof input?.url === "string" && input.url) ||
    (typeof input?.placeId === "string" && input.placeId) ||
    "";
  return clip(String(raw), 200) || call.tool;
}

export interface RecordedStep {
  traceStepId: string;
  /** Observaciones que nacieron en este paso, para enlazar la evidencia. */
  observationIds: string[];
}

export async function recordToolCall(args: {
  scanId: string;
  prospectId: string | null;
  call: AgentToolCall;
}): Promise<RecordedStep> {
  const { call } = args;

  // Solo lo que hace falta para depurar: el volcado íntegro vive en la
  // observación, no en la traza.
  const output = call.ok
    ? {
        observations: call.observations.map((o) => ({
          id: o.id,
          url: o.url,
          layer: o.layer,
          method: o.method,
          quote: clip(o.quote, 600),
          /*
           * La clave de la captura se anota aquí y no solo en la evidencia
           * porque la evidencia se escribe al final del run, cuando el agente
           * ya ha entregado el informe. La ventana en vivo necesita la imagen
           * mientras el agente sigue trabajando, y este es el único sitio que
           * se escribe en el momento en que la captura existe.
           */
          screenshot: o.screenshot?.storageKey ?? null,
        })),
      }
    : { errorCode: call.errorCode };

  const cacheHits = call.observations.filter(
    (o) => (o.raw as { cacheHit?: boolean } | undefined)?.cacheHit === true,
  ).length;

  const [row] = await db
    .insert(traceSteps)
    .values({
      scanId: args.scanId,
      prospectId: args.prospectId,
      step: call.tool,
      target: targetFor(call),
      status: statusFor(call),
      startedAt: new Date(call.startedAt),
      durationMs: call.durationMs,
      input: call.input as never,
      output: output as never,
      robotsRespected: config.CRAWL_RESPECT_ROBOTS,
      requestsPerSecond: config.CRAWL_REQUESTS_PER_SECOND,
      cacheHits,
    })
    .returning({ id: traceSteps.id });

  if (!row) throw new Error("no se pudo escribir el paso de traza");

  return { traceStepId: row.id, observationIds: call.observations.map((o) => o.id) };
}

/**
 * Paso que no es una llamada a herramienta: el propio run del agente, la
 * búsqueda de la zona, el cálculo del score. Son los que llevan modelo, tokens
 * y coste, y los que alimentan el filtro "Llamadas a IA".
 */
export async function recordStep(args: {
  scanId: string;
  prospectId?: string | null;
  step: string;
  target: string;
  status: TraceStatus;
  startedAt: Date;
  durationMs: number;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number;
  input?: unknown;
  output?: unknown;
}): Promise<string> {
  const [row] = await db
    .insert(traceSteps)
    .values({
      scanId: args.scanId,
      prospectId: args.prospectId ?? null,
      step: args.step,
      target: clip(args.target, 200),
      status: args.status,
      startedAt: args.startedAt,
      durationMs: args.durationMs,
      model: args.model ?? null,
      tokensIn: args.tokensIn ?? null,
      tokensOut: args.tokensOut ?? null,
      costUsd: String(args.costUsd ?? 0),
      input: (args.input ?? null) as never,
      output: (args.output ?? null) as never,
    })
    .returning({ id: traceSteps.id });

  if (!row) throw new Error("no se pudo escribir el paso de traza");
  return row.id;
}
