/**
 * Proveedor `anthropic-api`: la API de pago.
 *
 * Existe por lo que dice el handoff §10.2 punto 3: mantener las dos
 * implementaciones cuesta poco y permite migrar sin tocar el resto cuando esto
 * deje de ser una herramienta interna. El bucle está escrito a mano en vez de
 * con el tool runner del SDK para poder cortar exactamente en `maxTurns` y en
 * `maxCostUsd` — un bucle agéntico sin tope duro no termina.
 *
 * La salida final llega por una herramienta `submit_audit` en vez de por
 * `output_config.format`: así la última decisión del agente es una llamada más
 * y no un cambio de modo, y el mismo bucle sirve para cerrar el run.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  AgentRun,
  AgentStopReason,
  AgentTool,
  LLMProvider,
  Observation,
} from "@borsoga/shared";
import { config } from "../config";
import { errorMessage, log } from "../log";
import { RunRecorder } from "./recorder";

const SUBMIT = "submit_audit";

/** USD por millón de tokens. Solo para el tope de gasto, no para facturar. */
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

function priceOf(model: string): { in: number; out: number } {
  return PRICING[model] ?? PRICING["claude-opus-5"]!;
}

function jsonSchemaOf(agentTool: AgentTool): Record<string, unknown> {
  return z.toJSONSchema(z.object(agentTool.inputSchema), {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;
}

export const anthropicApiProvider: LLMProvider = {
  name: "anthropic-api",

  async runAgent(args): Promise<AgentRun> {
    if (!config.ANTHROPIC_API_KEY) {
      throw new Error("LLM_PROVIDER=anthropic-api exige ANTHROPIC_API_KEY.");
    }

    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    const recorder = new RunRecorder(args.onStep);
    const model = config.LLM_MODEL;
    const price = priceOf(model);

    const byName = new Map(args.tools.map((t) => [t.name as string, t as AgentTool<never>]));

    const tools: Anthropic.Tool[] = [
      ...args.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: jsonSchemaOf(t) as Anthropic.Tool.InputSchema,
      })),
      {
        name: SUBMIT,
        description:
          "Entrega el informe final del prospecto y termina. Todo hallazgo debe citar en evidenceRef " +
          "el id de una observación que te haya devuelto una herramienta en este mismo run.",
        input_schema: args.schema as Anthropic.Tool.InputSchema,
      },
    ];

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: args.prompt }];

    let json: unknown = null;
    let turns = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    let stopReason: AgentStopReason = "failed";

    try {
      while (true) {
        if (args.ctx.signal.aborted) {
          stopReason = "aborted";
          break;
        }
        if (turns >= args.maxTurns) {
          stopReason = "max_turns";
          break;
        }
        if (costUsd >= args.maxCostUsd) {
          stopReason = "budget_exceeded";
          break;
        }

        const response = await client.messages.create(
          {
            model,
            max_tokens: 16_000,
            system: args.system,
            tools,
            messages,
            thinking: { type: "adaptive" },
          },
          { signal: args.ctx.signal },
        );

        turns += 1;
        const usedIn =
          response.usage.input_tokens +
          (response.usage.cache_read_input_tokens ?? 0) +
          (response.usage.cache_creation_input_tokens ?? 0);
        tokensIn += usedIn;
        tokensOut += response.usage.output_tokens;
        costUsd += (usedIn * price.in + response.usage.output_tokens * price.out) / 1_000_000;

        if (response.stop_reason === "refusal") {
          log.warn("el modelo rechazó la petición", { stopDetails: response.stop_details });
          stopReason = "failed";
          break;
        }

        messages.push({ role: "assistant", content: response.content });

        const toolUses = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );

        if (toolUses.length === 0) {
          // Terminó de hablar sin entregar el informe: se le recuerda una vez.
          stopReason = "completed";
          break;
        }

        const results: Anthropic.ToolResultBlockParam[] = [];
        let submitted = false;

        for (const use of toolUses) {
          if (use.name === SUBMIT) {
            json = use.input;
            submitted = true;
            results.push({ type: "tool_result", tool_use_id: use.id, content: "Recibido." });
            continue;
          }

          const agentTool = byName.get(use.name);
          if (!agentTool) {
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: `Herramienta desconocida: ${use.name}`,
              is_error: true,
            });
            continue;
          }

          const result = await recorder.invoke(agentTool, use.input, args.ctx);
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: RunRecorder.renderForModel(result),
            ...(result.ok ? {} : { is_error: true }),
          });
        }

        messages.push({ role: "user", content: results });

        if (submitted) {
          stopReason = "completed";
          break;
        }
      }
    } catch (err) {
      if (args.ctx.signal.aborted) stopReason = "aborted";
      else log.error("el bucle de la API falló", { err: errorMessage(err) });
    }

    return {
      json,
      toolCalls: recorder.toolCalls,
      observations: recorder.observations as Map<string, Observation>,
      turns,
      tokensIn,
      tokensOut,
      costUsd,
      stopReason,
      model,
    };
  },
};
