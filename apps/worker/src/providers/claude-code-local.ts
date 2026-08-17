/**
 * Proveedor `claude-code-local`: Agent SDK contra la suscripción Max.
 *
 * Las herramientas se exponen como un servidor MCP en el mismo proceso, así
 * que corren aquí dentro y no hay transporte que pueda inventarse una
 * observación. El agente solo ve estas herramientas: `tools: []` apaga las
 * integradas de Claude Code y `settingSources: []` evita heredar el
 * `CLAUDE.md` ni los ajustes de quien lance el worker — el auditor no debe
 * comportarse distinto según la máquina.
 *
 * Advertencia que el handoff §10.2 deja escrita y sigue valiendo: una
 * suscripción de consumo es para uso interactivo de una persona. Vale para una
 * herramienta interna que lanzáis vosotros; para producto multiusuario toca
 * `anthropic-api`.
 */

import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
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

const SERVER_NAME = "prospector";

/** El CLI prefija los nombres de las herramientas MCP con el servidor. */
const qualify = (name: string) => `mcp__${SERVER_NAME}__${name}`;

function stopReasonFor(subtype: string): AgentStopReason {
  switch (subtype) {
    case "success":
      return "completed";
    case "error_max_turns":
      return "max_turns";
    case "error_max_budget_usd":
      return "budget_exceeded";
    default:
      return "failed";
  }
}

export const claudeCodeLocalProvider: LLMProvider = {
  name: "claude-code-local",

  async runAgent(args): Promise<AgentRun> {
    const recorder = new RunRecorder(args.onStep);

    const sdkTools = args.tools.map((agentTool: AgentTool) =>
      tool(
        agentTool.name,
        agentTool.description,
        agentTool.inputSchema,
        async (input: unknown) => {
          const result = await recorder.invoke(agentTool as AgentTool<never>, input, args.ctx);
          return {
            content: [{ type: "text" as const, text: RunRecorder.renderForModel(result) }],
            ...(result.ok ? {} : { isError: true }),
          };
        },
      ),
    );

    const server = createSdkMcpServer({
      name: SERVER_NAME,
      version: "0.1.0",
      tools: sdkTools,
      alwaysLoad: true,
    });

    /*
     * `WebSearch` es la única integrada que se enciende, y se enciende porque
     * la app quiere que el auditor investigue como investiga una persona con
     * Claude: buscar dónde está la mención, la nota de prensa o el perfil.
     *
     * Lo que NO cambia es de dónde sale la evidencia. Una búsqueda no pasa por
     * `observe()`, así que no produce `Observation` y no se puede citar. Sirve
     * para encontrar la URL; leerla y citarla sigue siendo trabajo de
     * `fetch_served_html` o `render_dom`. Buscar libre, citar con disciplina.
     */
    const builtIns = config.LLM_WEB_SEARCH ? (["WebSearch"] as const) : ([] as const);

    const allowed = new Set([
      ...args.tools.map((t) => qualify(t.name)),
      ...builtIns,
    ]);

    const session = query({
      prompt: args.prompt,
      options: {
        systemPrompt: args.system,
        model: config.LLM_MODEL,
        cwd: process.cwd(),

        // Nuestras herramientas más, como mucho, `WebSearch`. Nada de Bash ni
        // Read, y nada del entorno de quien lanza el worker — ni ajustes, ni
        // CLAUDE.md, ni skills, ni plugins: el auditor tiene que comportarse
        // igual en cualquier máquina.
        //
        // Esa poda es también lo que mantiene el prefijo del harness en unos
        // cientos de tokens en vez de ~120.000. Encender una integrada añade su
        // definición, no las veinte, pero el efecto se mide: ver `tokens_in`
        // del paso `audit.run` en la Traza antes y después.
        tools: [...builtIns],
        mcpServers: { [SERVER_NAME]: server },
        allowedTools: [...allowed],
        settingSources: [],
        skills: [],
        plugins: [],

        // Un bucle agéntico puede no terminar. Estos dos son la red.
        maxTurns: args.maxTurns,
        maxBudgetUsd: args.maxCostUsd,

        outputFormat: { type: "json_schema", schema: args.schema },

        // No hay `canUseTool`: un nombre suelto en `allowedTools` ya aprueba la
        // herramienta antes de que se consulte el callback, así que el permiso
        // lo dan `tools: []` (nada integrado) y esta lista, y no un gate que el
        // SDK avisa de que nunca llegará a ejecutarse.
        stderr: (data) => log.debug("agent-sdk", { stderr: data.trim().slice(0, 400) }),
      },
    });

    const abort = () => session.close();
    args.ctx.signal.addEventListener("abort", abort, { once: true });

    let json: unknown = null;
    let turns = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    let stopReason: AgentStopReason = "failed";
    let model = config.LLM_MODEL;

    try {
      for await (const message of session) {
        if (message.type === "assistant") {
          model = message.message.model ?? model;
          if (message.error) {
            log.warn("turno del modelo con error", { error: message.error });
          }
        }

        if (message.type !== "result") continue;

        turns = message.num_turns;
        costUsd = message.total_cost_usd;
        stopReason = stopReasonFor(message.subtype);

        // Los tokens salen de `modelUsage` y no de `usage`: el campo agregado
        // llega a cero en runs donde `modelUsage` sí trae cifras, y además así
        // se cuentan los modelos auxiliares que usa el harness — la Traza tiene
        // que enseñar lo que se gastó, no lo que gastó un solo modelo.
        for (const usage of Object.values(message.modelUsage)) {
          tokensIn +=
            usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
          tokensOut += usage.outputTokens;
        }

        if (message.subtype === "success") {
          json = message.structured_output ?? null;
        } else {
          log.warn("el agente terminó sin salida estructurada", {
            subtype: message.subtype,
            errors: message.errors.slice(0, 3),
          });
        }
      }
    } catch (err) {
      if (args.ctx.signal.aborted) stopReason = "aborted";
      else log.error("el bucle del Agent SDK falló", { err: errorMessage(err) });
    } finally {
      args.ctx.signal.removeEventListener("abort", abort);
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
