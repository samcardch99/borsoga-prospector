/**
 * Borsoga Prospector — capa agéntica.
 *
 * Decisión de arquitectura (se aparta del handoff §10.1 a propósito):
 * el handoff proponía un pipeline determinista que decidía qué comprobar, con
 * el LLM invocado solo en los puntos de juicio. Aquí la IA conduce el proceso
 * entero: recibe un negocio y decide por sí misma qué mirar, en qué orden,
 * cuándo profundizar y cuándo parar.
 *
 * Lo único que NO se le delega es la acuñación de la evidencia. Las
 * herramientas devuelven `Observation`s con la URL, la cita textual y la fecha
 * de lo que realmente ocurrió; el agente las cita por id. Así se conserva la
 * regla del auditor ("sin evidencia no hay hallazgo") sin recortarle iniciativa
 * al modelo: puede investigar lo que quiera, pero no puede afirmar haber visto
 * algo que ninguna herramienta vio.
 *
 * Las herramientas son la superficie a ampliar. Si el agente necesita una
 * comprobación nueva, se añade aquí en vez de reintroducir pasos fijos.
 */

import type { ZodRawShape } from "zod";
import type { Evidence, EvidenceLayer } from "./types";

// ─── Herramientas ────────────────────────────────────────────────────────────

export type AgentToolName =
  /** Ficha de Places por placeId. Cachea 30 días; cuenta contra la cuota. */
  | "places_details"
  /** Descubrimiento: negocios de una zona raspando Google Maps. */
  | "search_maps"
  /** HTML tal cual lo sirve el servidor — lo que ve el buscador. */
  | "fetch_served_html"
  /** DOM tras ejecutar JS en navegador real — lo que ve el usuario. */
  | "render_dom"
  /** Captura de pantalla a un ancho dado; devuelve storageKey. */
  | "screenshot"
  /** Lighthouse sobre una URL: rendimiento, accesibilidad, SEO. */
  | "lighthouse"
  /** Sigue enlaces del sitio respetando robots.txt y 1 req/s. */
  | "crawl_site"
  /** Envío de prueba del formulario de contacto del propio prospecto. */
  | "probe_contact_form"
  /** Hash perceptual de imágenes para detectar banco de imágenes. */
  | "image_fingerprint"
  /** Búsqueda web para prensa, menciones, directorios y NAP. */
  | "search_web"
  /** Lectura de un perfil o directorio externo (Houzz, BBB, Yelp, LinkedIn). */
  | "fetch_external_profile";

/**
 * Lo que una herramienta observó. Es el único origen legítimo de evidencia:
 * el agente cita `id`, y el worker resuelve el objeto `Evidence` completo.
 */
export interface Observation {
  id: string;
  tool: AgentToolName;
  url: string;
  /** Cita textual o volcado. Recortado para el contexto, íntegro en disco. */
  quote: string;
  layer: EvidenceLayer;
  /** "navegador real · 1440×900", "curl + navegador", "hash de imagen". */
  method: string;
  capturedAt: string; // ISO 8601
  screenshot?: {
    storageKey: string;
    width: number;
    height: number;
    takenAt: string;
  };
  /** Datos crudos para el panel de detalle de Traza. */
  raw?: unknown;
}

export interface AgentToolCall {
  id: string;
  tool: AgentToolName;
  input: unknown;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  errorCode: string | null;
  /** Observaciones que produjo esta llamada, si produjo alguna. */
  observations: Observation[];
}

export type ToolResult =
  | { ok: true; observations: Observation[]; summary: string }
  | { ok: false; errorCode: string; message: string };

/** Implementación real de una herramienta, inyectada por el worker. */
export interface AgentTool<TInput = unknown> {
  name: AgentToolName;
  description: string;
  /**
   * Forma zod del input, una sola fuente de verdad para los dos proveedores:
   * `claude-code-local` se la pasa tal cual al `tool()` del Agent SDK, y
   * `anthropic-api` la convierte con `z.toJSONSchema()`. Escribirla dos veces
   * (zod aquí, JSON Schema allá) es la manera segura de que se separen.
   */
  inputSchema: ZodRawShape;
  run(input: TInput, ctx: AgentToolContext): Promise<ToolResult>;
}

export interface AgentToolContext {
  scanId: string;
  prospectId: string | null;
  /** Aborta la herramienta cuando el run supera su presupuesto o se cancela. */
  signal: AbortSignal;
  /** Buena vecindad: el worker aplica el límite por dominio aquí. */
  rateLimit(domain: string): Promise<void>;
  /**
   * El área de la zona que se está escaneando.
   *
   * Va aquí y no en la entrada de `search_maps` porque *dónde* buscar no es
   * decisión del agente: lo fija la zona. Cuando lo era, el agente estrechaba
   * el radio por su cuenta —2 000 m en una zona de 8 000— y casi todos los
   * resultados caían fuera del filtro de distancia. Buscaba bien y encontraba
   * poco, que es el fallo más difícil de ver.
   */
  area?: { lat: number; lng: number; radiusMeters: number };
}

// ─── El run ──────────────────────────────────────────────────────────────────

export interface AgentRun {
  /** Salida estructurada, ya validada contra `schemaName`. */
  json: unknown;
  /** Todo lo que el agente miró, en orden. Alimenta la vista de Traza. */
  toolCalls: AgentToolCall[];
  /** Índice plano de observaciones, para resolver `evidenceRef`. */
  observations: Map<string, Observation>;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** "completed" | "max_turns" | "budget_exceeded" | "aborted" | "failed". */
  stopReason: AgentStopReason;
  model: string;
}

export type AgentStopReason =
  | "completed"
  | "max_turns"
  | "budget_exceeded"
  | "aborted"
  | "failed";

/**
 * Dos implementaciones, elegidas por variable de entorno:
 *  - claude-code-local: Agent SDK contra la suscripción Max (worker local).
 *  - anthropic-api: API de pago, para cuando esto sea multiusuario.
 *
 * Mantener las dos cuesta poco y permite migrar sin tocar el resto — el
 * handoff insiste en esto y sigue valiendo con el enfoque agéntico.
 */
export interface LLMProvider {
  name: "claude-code-local" | "anthropic-api";

  runAgent(args: {
    system: string;
    prompt: string;
    /** Herramientas que el agente puede invocar. Él decide cuáles y cuándo. */
    tools: AgentTool[];
    ctx: AgentToolContext;
    /** Esquema JSON de la salida final; el proveedor valida antes de devolver. */
    schemaName: string;
    schema: Record<string, unknown>;
    /** Topes duros. Sin ellos un bucle agéntico puede no terminar. */
    maxTurns: number;
    maxCostUsd: number;
    /** Se llama en cada paso, para que Traza se actualice en vivo. */
    onStep?: (call: AgentToolCall) => void;
  }): Promise<AgentRun>;
}

// ─── Resolución de evidencia ─────────────────────────────────────────────────

/**
 * Convierte un `evidenceRef` del agente en la `Evidence` que se persiste.
 * Devuelve null si el ref no corresponde a ninguna observación de este run —
 * ese hallazgo se descarta y se reintenta. Es el punto exacto donde se hace
 * cumplir "sin evidencia no hay hallazgo".
 */
export function resolveEvidence(
  run: AgentRun,
  evidenceRef: string,
  additionalRefs: string[] = [],
): Evidence | null {
  const obs = run.observations.get(evidenceRef);
  if (!obs) return null;

  const extras = additionalRefs
    .map((ref) => run.observations.get(ref))
    .filter((o): o is Observation => o !== undefined)
    .map((o) => ({ url: o.url, quote: o.quote, capturedAt: o.capturedAt }));

  return {
    id: obs.id,
    traceStepId: null, // lo rellena el worker al persistir el paso
    url: obs.url,
    quote: obs.quote,
    layer: obs.layer,
    method: obs.method,
    capturedAt: obs.capturedAt,
    ...(obs.screenshot ? { screenshot: obs.screenshot } : {}),
    ...(extras.length > 0 ? { additionalSources: extras } : {}),
  };
}
