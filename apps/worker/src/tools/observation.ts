/**
 * Acuñación de observaciones.
 *
 * Este archivo es el punto donde se sostiene la regla del auditor. El agente
 * decide qué mirar y cuándo, pero no escribe `url`, `quote` ni `capturedAt`:
 * los pone la herramienta que miró de verdad, aquí. Lo único que el agente
 * puede citar después es el `id` que le devolvimos.
 */

import { randomUUID } from "node:crypto";
import type { AgentToolName, EvidenceLayer, Observation } from "@borsoga/shared";
import type { StoredScreenshot } from "../storage";

/** Cita para el contexto del modelo. El volcado íntegro va en `raw`. */
export const QUOTE_LIMIT = 4_000;

export function clip(text: string, limit = QUOTE_LIMIT): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}… [recortado]`;
}

export function observe(args: {
  tool: AgentToolName;
  url: string;
  quote: string;
  layer: EvidenceLayer;
  method: string;
  screenshot?: StoredScreenshot;
  raw?: unknown;
}): Observation {
  return {
    id: `obs_${randomUUID()}`,
    tool: args.tool,
    url: args.url,
    quote: clip(args.quote),
    layer: args.layer,
    method: args.method,
    capturedAt: new Date().toISOString(),
    ...(args.screenshot ? { screenshot: args.screenshot } : {}),
    ...(args.raw !== undefined ? { raw: args.raw } : {}),
  };
}
