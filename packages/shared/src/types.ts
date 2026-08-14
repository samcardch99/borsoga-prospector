/**
 * Borsoga Prospector — contrato de datos
 * Copiar al repo (p. ej. packages/shared/src/types.ts) y trabajar desde aquí.
 * Regla de oro: sin evidencia no hay hallazgo, y la IA propone pero no decide.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Las tres ramas de servicio de Borsoga. Un hallazgo pertenece a una sola. */
export type Branch = "renders" | "web" | "branding";

export type Severity = "critical" | "high" | "medium" | "low";

/** La IA crea todo como "pending". Solo un humano mueve a los demás estados. */
export type Verdict = "pending" | "confirmed" | "nuanced" | "discarded";

/**
 * Qué capa se comprobó. Distinguir el HTML servido (lo que ve el buscador)
 * del DOM renderizado (lo que ve el usuario) es un requisito del auditor.
 */
export type EvidenceLayer =
  | "served_html"
  | "rendered_dom"
  | "both_equal"
  | "mismatch"
  | "external_source";

export type PipelineStage =
  | "detected"
  | "reviewed"
  | "proposal_sent"
  | "meeting"
  | "won"
  | "lost";

export type County = "miami_dade" | "broward" | "palm_beach";

export type Sector =
  | "construction"
  | "remodeling"
  | "real_estate_development"
  | "modular_homes"
  | "closets"
  | "kitchens"
  | "millwork"
  | "cabinetry"
  | "interior_design";

/** Motivos de descarte del ICP. Se guardan, no se borra el prospecto. */
export type DisqualifyReason =
  | "national_franchise"
  | "has_in_house_agency"
  | "too_large"
  | "no_own_product"
  | "no_website_no_product"
  | "ticket_too_low"
  | "out_of_area"
  | "already_client"
  | "manual";

// ─── Evidencia ───────────────────────────────────────────────────────────────

export interface Evidence {
  /**
   * Id de la observación. Lo acuña la herramienta que miró, y es lo que el
   * agente cita en `AuditorOutput.findings[].evidenceRef`.
   */
  id: string;
  /** Paso del agente (llamada a herramienta) que produjo esta observación. */
  traceStepId: string | null;
  /** URL exacta comprobada. Obligatoria. */
  url: string;
  /** Cita textual o volcado (cabeceras, fragmento de HTML, respuesta). Obligatoria. */
  quote: string;
  layer: EvidenceLayer;
  /** Cómo se comprobó: "navegador real · 1440×900", "curl + navegador", "hash de imagen". */
  method: string;
  capturedAt: string; // ISO 8601
  /** Captura de pantalla guardada por el crawler. */
  screenshot?: {
    storageKey: string;
    width: number;
    height: number;
    takenAt: string;
  };
  /** Cuando el hallazgo cruza varias fuentes (NAP inconsistente, marca fragmentada). */
  additionalSources?: Array<{ url: string; quote: string; capturedAt: string }>;
}

// ─── Hallazgo ────────────────────────────────────────────────────────────────

export interface Finding {
  id: string;
  prospectId: string;
  branch: Branch;
  severity: Severity;
  verdict: Verdict;
  /** Titular en lenguaje llano, sin jerga. Aparece tal cual en la propuesta. */
  title: string;
  /** Qué se encontró, con los datos concretos. */
  description: string;
  /** Qué gana el cliente al resolverlo, en términos de ventas, no técnicos. */
  clientGain: string;
  evidence: Evidence;
  detectedAt: string;
  /** Última verificación (automática o humana). */
  verifiedAt: string;
  /** Quién fijó el veredicto actual: null si sigue siendo el de la IA. */
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Nota del revisor cuando el veredicto es "nuanced". */
  reviewNote?: string;
  /** Excluido de la propuesta sin descartar el hallazgo. */
  excludedFromProposal: boolean;
  /** Orden dentro de su rama en la propuesta. */
  proposalOrder: number | null;
  /** Intentos de reverificación pedidos desde la cola. */
  recheckCount: number;
  /** Trazabilidad: paso del agente que lo generó. */
  traceStepId: string | null;
}

// ─── Personas y menciones ────────────────────────────────────────────────────

export interface Person {
  id: string;
  prospectId: string;
  name: string;
  role: string;
  /** 0–100. Por debajo de ~70 la interfaz lo marca como inferido. */
  confidence: number;
  profiles: Array<{
    network: "linkedin" | "instagram" | "facebook" | "tiktok" | "x" | "other";
    handleOrUrl: string;
    isPrivate: boolean;
  }>;
  /** inferred: true cuando el valor se deduce del patrón del dominio. */
  emails: Array<{ value: string; inferred: boolean; source: string }>;
  phones: Array<{ value: string; inferred: boolean; source: string }>;
  /** Señales de intención de compra: contrataciones, expansión, declaraciones. */
  buyingSignals: Array<{ text: string; source: string; date: string }>;
  /** Fuente de cada dato personal, para poder justificar su origen. */
  provenance: string[];
  collectedAt: string;
}

export interface Mention {
  id: string;
  prospectId: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string | null;
  sentiment: "positive" | "neutral" | "negative";
}

// ─── Prospecto ───────────────────────────────────────────────────────────────

export interface Prospect {
  id: string;
  placeId: string;
  name: string;
  sectors: Sector[];
  county: County;
  city: string;
  address: string;
  location: { lat: number; lng: number };
  website: string | null;
  phone: string | null;
  employeesEstimate: number | null;

  ratings: Array<{
    source: "google" | "houzz" | "bbb" | "yelp";
    score: number;
    reviewCount: number;
    unansweredNegative?: number;
  }>;

  /** Score total ponderado, 0–100. */
  score: number;
  /** Score por rama, 0–100. */
  branchScores: Record<Branch, number>;
  /** Ticket estimado por rama, en USD. */
  branchTickets: Record<Branch, number>;
  ticketEstimate: number;
  /** Factores del cálculo, para poder explicar el score en la interfaz. */
  scoreFactors: Array<{ label: string; weight: number; value: number }>;

  icpFit: "high" | "medium" | "low";
  disqualified: boolean;
  disqualifyReason: DisqualifyReason | null;
  /** Motivo legible que se muestra en gris junto al prospecto descartado. */
  disqualifyNote: string | null;

  /** Prosa honesta sobre viabilidad: crecimiento, crisis, franquicia, agencia. */
  commercialViability: string;
  growthSignals: string[];

  stage: PipelineStage;
  ownerId: string | null;
  lastActivityAt: string | null;

  findings: Finding[];
  people: Person[];
  mentions: Mention[];

  zoneId: string;
  firstSeenAt: string;
  lastScannedAt: string;
}

// ─── Zonas y escaneos ────────────────────────────────────────────────────────

export interface Zone {
  id: string;
  name: string;
  county: County;
  center: { lat: number; lng: number };
  radiusMeters: number;
  sectors: Sector[];
  minTicketUsd: number;
  /** Expresión cron. null = solo manual. */
  schedule: string | null;
  active: boolean;
  lastScanAt: string | null;
  lastScanProspects: number | null;
  lastScanCostUsd: number | null;
  createdAt: string;
}

export type ScanStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "quota_exceeded"
  | "cancelled";

export interface Scan {
  id: string;
  zoneId: string;
  status: ScanStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Progreso que alimenta el panel del mapa y el estado de carga. */
  progress: {
    found: number;
    icpFiltered: number;
    disqualified: number;
    audited: number;
    total: number;
  };
  totals: {
    steps: number;
    tokens: number;
    costUsd: number;
    errors: number;
  };
  /** Código exacto del error, p. ej. "OVER_QUERY_LIMIT". Se muestra al usuario. */
  errorCode: string | null;
  errorMessage: string | null;
  /** Dónde se detuvo, para poder reanudar. */
  resumeCursor: string | null;
}

// ─── Traza del agente ────────────────────────────────────────────────────────

export type TraceStatus = "ok" | "retry" | "error" | "timeout" | "http_404" | "skipped";

export interface TraceStep {
  id: string;
  scanId: string;
  prospectId: string | null;
  /** "places.nearbySearch", "crawl.page", "audit.branch · renders", "score.compute". */
  step: string;
  target: string;
  status: TraceStatus;
  startedAt: string;
  durationMs: number;
  /** Solo en pasos con LLM. */
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number;
  /** Payloads recortados para el panel de detalle. */
  input: unknown;
  output: unknown;
  retries: number;
  /** Señales de buena vecindad que la vista de Traza expone. */
  compliance?: {
    robotsRespected: boolean;
    requestsPerSecond: number;
    cacheHits: number;
  };
}

// ─── Propuesta ───────────────────────────────────────────────────────────────

export type ProposalBlockType =
  | "fixed"        // membrete, condiciones
  | "text"         // texto escrito a mano
  | "ai_text"      // texto que la IA puede reescribir
  | "findings"     // hallazgos con o sin evidencia
  | "pricing";     // tabla de fases y precios

export interface ProposalBlock {
  id: string;
  type: ProposalBlockType;
  name: string;
  enabled: boolean;
  order: number;
  content: string | null;
  /** Para bloques de hallazgos. */
  findingIds?: string[];
  includeScreenshots?: boolean;
}

export interface ProposalPhase {
  id: string;
  branch: Branch;
  name: string;
  deliverables: string[];
  priceUsd: number;
  weeks: string;
  enabled: boolean;
  order: number;
  /** Hallazgos que esta fase resuelve. */
  findingIds: string[];
}

export interface Proposal {
  id: string;
  prospectId: string;
  status: "draft" | "sent" | "opened" | "accepted" | "rejected";
  language: "es" | "en";
  tone: "direct" | "warm" | "technical";
  template: string;
  recipient: { personId: string | null; name: string; email: string };
  blocks: ProposalBlock[];
  phases: ProposalPhase[];
  subtotalUsd: number;
  discountUsd: number;
  totalUsd: number;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  openedAt: string | null;
  pdfStorageKey: string | null;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export interface ScanRequest {
  zoneId: string;
  /** Fuerza el reescaneo de prospectos ya cacheados. */
  refresh?: boolean;
}

export interface ScanEstimate {
  expectedBusinesses: number;
  estimatedCostUsd: number;
  placesCallsNeeded: number;
  placesCallsRemaining: number;
}

export interface ProspectListQuery {
  zoneId?: string;
  minScore?: number;
  branches?: Branch[];
  sectors?: Sector[];
  stages?: PipelineStage[];
  includeDisqualified?: boolean;
  /** Solo prospectos con hallazgos pendientes de revisión. */
  needsReview?: boolean;
  sort?: "score" | "ticket" | "recent";
  cursor?: string;
  limit?: number;
}

export interface ReviewAction {
  findingId: string;
  action: "confirm" | "nuance" | "discard" | "recheck";
  /** Obligatoria en "nuance". */
  note?: string;
  /** Correcciones del revisor sobre el texto de la IA. */
  patch?: Partial<Pick<Finding, "title" | "description" | "clientGain" | "severity" | "branch">>;
}

export interface QuotaStatus {
  placesUsed: number;
  placesLimit: number;
  resetsAt: string;
  llmCostMonthUsd: number;
  /** "claude-code-local" cuando corre contra la suscripción. */
  llmProvider: "claude-code-local" | "anthropic-api";
}

// ─── Salida del agente auditor ───────────────────────────────────────────────

/**
 * Lo que devuelve el agente auditor al final de su bucle. El worker lo valida
 * (zod) antes de persistir: cualquier hallazgo cuyo `evidenceRef` no case con
 * una observación real de este mismo run se rechaza y se reintenta.
 *
 * Nota sobre `evidenceRef`: el agente NO redacta el objeto `Evidence`. Cita el
 * id que le devolvió la herramienta cuando comprobó algo. Es lo que impide que
 * un hallazgo se apoye en una URL recordada en vez de visitada — la IA decide
 * todo el proceso, pero la cita textual y la fecha las pone quien miró.
 */
export interface AuditorOutput {
  company: {
    name: string;
    sectors: Sector[];
    city: string;
    county: County;
    website: string | null;
    ratings: Array<{ source: string; score: number; reviewCount: number }>;
  };
  opportunityScore: number;
  icpFit: "high" | "medium" | "low";
  disqualified: boolean;
  disqualifyReason: DisqualifyReason | null;
  commercialViability: string;
  findings: Array<{
    title: string;
    description: string;
    branch: Branch;
    clientGain: string;
    severity: Severity;
    verdict: Extract<Verdict, "pending" | "nuanced" | "discarded">;
    /** Id de una observación devuelta por una herramienta en este run. */
    evidenceRef: string;
    /** Refs adicionales cuando el hallazgo cruza fuentes (NAP, marca). */
    additionalEvidenceRefs?: string[];
  }>;
}

// ─── Proveedor de LLM (agéntico) ─────────────────────────────────────────────
// Ver ./agent.ts. El contrato original del handoff era `complete()`: un solo
// disparo entrada→JSON, con el pipeline determinista alrededor decidiendo qué
// mirar. Aquí la IA conduce el proceso entero y decide qué comprobar y cuándo,
// así que el proveedor expone un bucle con herramientas en vez de una función.
//
// Lo que no cambia: la evidencia la acuñan las herramientas, no el texto del
// modelo. `url`, `quote`, `capturedAt` y `layer` salen de lo que la herramienta
// observó de verdad. La IA elige qué mirar; no elige qué dice haber visto.
export type {
  LLMProvider,
  AgentRun,
  AgentToolCall,
  AgentToolName,
  ToolResult,
} from "./agent";
