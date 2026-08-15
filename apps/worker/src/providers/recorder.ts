/**
 * Registro de lo que el agente miró.
 *
 * Los dos proveedores comparten este envoltorio para que la Traza no dependa
 * de cuál está en uso: mismo cronómetro, mismos códigos de error, mismo índice
 * de observaciones. Es también donde se garantiza que toda observación que el
 * agente puede citar existe de verdad en este run.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentTool,
  AgentToolCall,
  AgentToolContext,
  Observation,
  ToolResult,
} from "@borsoga/shared";
import { errorMessage, log } from "../log";

export class RunRecorder {
  readonly toolCalls: AgentToolCall[] = [];
  readonly observations = new Map<string, Observation>();

  constructor(private readonly onStep?: (call: AgentToolCall) => void) {}

  async invoke(
    tool: AgentTool<never>,
    input: unknown,
    ctx: AgentToolContext,
  ): Promise<ToolResult> {
    const startedAt = new Date();
    const t0 = performance.now();

    let result: ToolResult;
    try {
      result = await tool.run(input as never, ctx);
    } catch (err) {
      // Una herramienta que revienta no puede tumbar el run: el agente tiene
      // que poder leer el fallo y decidir si prueba otra cosa.
      log.warn("herramienta lanzó excepción", { tool: tool.name, err: errorMessage(err) });
      result = { ok: false, errorCode: "TOOL_THREW", message: errorMessage(err) };
    }

    const observations = result.ok ? result.observations : [];
    for (const obs of observations) this.observations.set(obs.id, obs);

    const call: AgentToolCall = {
      id: `call_${randomUUID()}`,
      tool: tool.name,
      input,
      startedAt: startedAt.toISOString(),
      durationMs: Math.round(performance.now() - t0),
      ok: result.ok,
      errorCode: result.ok ? null : result.errorCode,
      observations,
    };

    this.toolCalls.push(call);
    this.onStep?.(call);

    return result;
  }

  /**
   * Lo que se le devuelve al modelo. Incluye los ids de observación porque son
   * lo que tendrá que citar en `evidenceRef` — si no los ve, no puede citarlos,
   * y un hallazgo sin ref se rechaza al validar.
   */
  static renderForModel(result: ToolResult): string {
    if (!result.ok) {
      return `ERROR ${result.errorCode}: ${result.message}`;
    }
    const refs = result.observations
      .map((o) => `- evidenceRef: ${o.id}\n  url: ${o.url}\n  ${o.quote}`)
      .join("\n\n");
    return `${result.summary}\n\nObservaciones citables:\n\n${refs}`;
  }
}
