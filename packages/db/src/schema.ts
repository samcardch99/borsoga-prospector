/**
 * Esquema Postgres — derivado de `@borsoga/shared`.
 *
 * Tres decisiones que conviene no deshacer:
 *
 * 1. `evidence` es su propia tabla, no una columna jsonb del hallazgo. La
 *    evidencia se consulta, se audita y se comparte entre hallazgos; enterrarla
 *    en jsonb la vuelve inconsultable justo cuando hace falta defenderla.
 *
 * 2. Un hallazgo NO puede existir sin evidencia: `findings.evidence_id` es
 *    NOT NULL. La regla del auditor se hace cumplir en el esquema, no solo en
 *    la validación del worker.
 *
 * 3. Los prospectos descartados no se borran. `disqualified` + motivo, y las
 *    consultas los excluyen por defecto — pero siguen ahí para corregir filtros.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const branchEnum = pgEnum("branch", ["renders", "web", "branding"]);
export const severityEnum = pgEnum("severity", ["critical", "high", "medium", "low"]);
export const verdictEnum = pgEnum("verdict", ["pending", "confirmed", "nuanced", "discarded"]);

export const evidenceLayerEnum = pgEnum("evidence_layer", [
  "served_html",
  "rendered_dom",
  "both_equal",
  "mismatch",
  "external_source",
]);

export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "detected",
  "reviewed",
  "proposal_sent",
  "meeting",
  "won",
  "lost",
]);

export const countyEnum = pgEnum("county", ["miami_dade", "broward", "palm_beach"]);

export const sectorEnum = pgEnum("sector", [
  "construction",
  "remodeling",
  "real_estate_development",
  "modular_homes",
  "closets",
  "kitchens",
  "millwork",
  "cabinetry",
  "interior_design",
]);

export const disqualifyReasonEnum = pgEnum("disqualify_reason", [
  "national_franchise",
  "has_in_house_agency",
  "too_large",
  "no_own_product",
  "no_website_no_product",
  "ticket_too_low",
  "out_of_area",
  "already_client",
  "manual",
]);

export const icpFitEnum = pgEnum("icp_fit", ["high", "medium", "low"]);

export const scanStatusEnum = pgEnum("scan_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "quota_exceeded",
  "cancelled",
]);

export const traceStatusEnum = pgEnum("trace_status", [
  "ok",
  "retry",
  "error",
  "timeout",
  "http_404",
  "skipped",
]);

export const proposalStatusEnum = pgEnum("proposal_status", [
  "draft",
  "sent",
  "opened",
  "accepted",
  "rejected",
]);

export const proposalBlockTypeEnum = pgEnum("proposal_block_type", [
  "fixed",
  "text",
  "ai_text",
  "findings",
  "pricing",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
]);

export const sentimentEnum = pgEnum("sentiment", ["positive", "neutral", "negative"]);

// ─── Zonas ───────────────────────────────────────────────────────────────────

export const zones = pgTable(
  "zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    county: countyEnum("county").notNull(),
    centerLat: doublePrecision("center_lat").notNull(),
    centerLng: doublePrecision("center_lng").notNull(),
    radiusMeters: integer("radius_meters").notNull(),
    sectors: sectorEnum("sectors").array().notNull().default(sql`'{}'`),
    minTicketUsd: integer("min_ticket_usd").notNull().default(0),
    /** Expresión cron. null = solo manual. */
    schedule: text("schedule"),
    active: boolean("active").notNull().default(true),
    lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
    lastScanProspects: integer("last_scan_prospects"),
    lastScanCostUsd: numeric("last_scan_cost_usd", { precision: 10, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("zones_active_idx").on(t.active)],
);

// ─── Escaneos ────────────────────────────────────────────────────────────────

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "cascade" }),
    status: scanStatusEnum("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    /** Progreso que alimenta el panel del mapa y el estado de carga. */
    progressFound: integer("progress_found").notNull().default(0),
    progressIcpFiltered: integer("progress_icp_filtered").notNull().default(0),
    progressDisqualified: integer("progress_disqualified").notNull().default(0),
    progressAudited: integer("progress_audited").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),

    totalSteps: integer("total_steps").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    totalErrors: integer("total_errors").notNull().default(0),

    /** Código exacto, p. ej. "OVER_QUERY_LIMIT". Se muestra al usuario. */
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    /** Dónde se detuvo, para poder reanudar. */
    resumeCursor: text("resume_cursor"),
  },
  (t) => [
    index("scans_zone_idx").on(t.zoneId),
    index("scans_status_idx").on(t.status),
    index("scans_started_idx").on(t.startedAt.desc()),
  ],
);

// ─── Prospectos ──────────────────────────────────────────────────────────────

export const prospects = pgTable(
  "prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placeId: text("place_id").notNull(),
    name: text("name").notNull(),
    sectors: sectorEnum("sectors").array().notNull().default(sql`'{}'`),
    county: countyEnum("county").notNull(),
    city: text("city").notNull(),
    address: text("address").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    website: text("website"),
    phone: text("phone"),
    employeesEstimate: integer("employees_estimate"),

    /** [{ source, score, reviewCount, unansweredNegative? }] */
    ratings: jsonb("ratings").notNull().default(sql`'[]'::jsonb`),

    score: smallint("score").notNull().default(0),
    /** { renders, web, branding } */
    branchScores: jsonb("branch_scores").notNull().default(sql`'{}'::jsonb`),
    branchTickets: jsonb("branch_tickets").notNull().default(sql`'{}'::jsonb`),
    ticketEstimate: integer("ticket_estimate").notNull().default(0),
    /** Factores del cálculo, para poder explicar el score en la interfaz. */
    scoreFactors: jsonb("score_factors").notNull().default(sql`'[]'::jsonb`),

    icpFit: icpFitEnum("icp_fit").notNull().default("low"),
    disqualified: boolean("disqualified").notNull().default(false),
    disqualifyReason: disqualifyReasonEnum("disqualify_reason"),
    /** Motivo legible que se muestra en gris junto al prospecto descartado. */
    disqualifyNote: text("disqualify_note"),

    /** Prosa honesta: crecimiento, crisis, franquicia, agencia. */
    commercialViability: text("commercial_viability").notNull().default(""),
    growthSignals: text("growth_signals").array().notNull().default(sql`'{}'`),

    stage: pipelineStageEnum("stage").notNull().default("detected"),
    ownerId: uuid("owner_id"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),

    zoneId: uuid("zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "restrict" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Un negocio de Places es un prospecto, aunque salga en dos zonas. */
    uniqueIndex("prospects_place_id_key").on(t.placeId),
    index("prospects_zone_idx").on(t.zoneId),
    index("prospects_stage_idx").on(t.stage),
    /** Orden por defecto de la lista: score desc, sin los descartados. */
    index("prospects_score_idx").on(t.score.desc()).where(sql`${t.disqualified} = false`),
    index("prospects_sectors_idx").using("gin", t.sectors),
  ],
);

// ─── Evidencia ───────────────────────────────────────────────────────────────
// Tabla propia y no jsonb: la evidencia se consulta y se defiende.

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    /** Paso del agente que la produjo. La cita nace de una herramienta. */
    traceStepId: uuid("trace_step_id"),

    url: text("url").notNull(),
    /** Cita textual o volcado. Obligatoria. */
    quote: text("quote").notNull(),
    layer: evidenceLayerEnum("layer").notNull(),
    /** "navegador real · 1440×900", "curl + navegador", "hash de imagen". */
    method: text("method").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),

    screenshotStorageKey: text("screenshot_storage_key"),
    screenshotWidth: integer("screenshot_width"),
    screenshotHeight: integer("screenshot_height"),
    screenshotTakenAt: timestamp("screenshot_taken_at", { withTimezone: true }),

    /** [{ url, quote, capturedAt }] cuando el hallazgo cruza fuentes. */
    additionalSources: jsonb("additional_sources").notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    index("evidence_prospect_idx").on(t.prospectId),
    index("evidence_trace_step_idx").on(t.traceStepId),
  ],
);

// ─── Hallazgos ───────────────────────────────────────────────────────────────

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),

    /** NOT NULL a propósito: sin evidencia no hay hallazgo. */
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),

    branch: branchEnum("branch").notNull(),
    severity: severityEnum("severity").notNull(),
    verdict: verdictEnum("verdict").notNull().default("pending"),

    /** Titular en lenguaje llano. Aparece tal cual en la propuesta. */
    title: text("title").notNull(),
    description: text("description").notNull(),
    /** Qué gana el cliente, en términos de ventas, no técnicos. */
    clientGain: text("client_gain").notNull(),

    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),

    /** null si el veredicto sigue siendo el que propuso la IA. */
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Obligatoria cuando el veredicto es "nuanced". */
    reviewNote: text("review_note"),

    excludedFromProposal: boolean("excluded_from_proposal").notNull().default(false),
    proposalOrder: smallint("proposal_order"),
    recheckCount: smallint("recheck_count").notNull().default(0),
    traceStepId: uuid("trace_step_id"),
  },
  (t) => [
    index("findings_prospect_idx").on(t.prospectId),
    index("findings_branch_idx").on(t.prospectId, t.branch),
    /** La cola de revisión: los pendientes, más antiguos primero. */
    index("findings_pending_idx")
      .on(t.detectedAt)
      .where(sql`${t.verdict} = 'pending'`),
  ],
);

// ─── Personas y menciones ────────────────────────────────────────────────────

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull(),
    /** 0–100. Por debajo de ~70 la interfaz lo marca como inferido. */
    confidence: smallint("confidence").notNull().default(0),

    /** [{ network, handleOrUrl, isPrivate }] */
    profiles: jsonb("profiles").notNull().default(sql`'[]'::jsonb`),
    /** [{ value, inferred, source }] — inferred distingue deducido de verificado. */
    emails: jsonb("emails").notNull().default(sql`'[]'::jsonb`),
    phones: jsonb("phones").notNull().default(sql`'[]'::jsonb`),
    /** [{ text, source, date }] */
    buyingSignals: jsonb("buying_signals").notNull().default(sql`'[]'::jsonb`),
    /** Fuente de cada dato personal, para justificar su origen. */
    provenance: text("provenance").array().notNull().default(sql`'{}'`),

    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
    /** Retención de datos personales: la purga borra por esta fecha. */
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => [
    index("people_prospect_idx").on(t.prospectId),
    index("people_purge_idx").on(t.purgeAfter),
  ],
);

export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    source: text("source").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sentiment: sentimentEnum("sentiment").notNull().default("neutral"),
  },
  (t) => [index("mentions_prospect_idx").on(t.prospectId)],
);

// ─── Traza del agente ────────────────────────────────────────────────────────
// Con el enfoque agéntico cada fila es una llamada a herramienta que la IA
// decidió hacer. La traza deja de ser un log de pasos fijos y pasa a ser el
// registro de lo que el agente eligió mirar — que es más útil para depurar.

export const traceSteps = pgTable(
  "trace_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").references(() => prospects.id, { onDelete: "cascade" }),

    /** "places.details", "render_dom", "audit.decide", "score.compute". */
    step: text("step").notNull(),
    target: text("target").notNull(),
    status: traceStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms").notNull().default(0),

    /** Solo en pasos con LLM. */
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),

    /** Payloads recortados para el panel de detalle. */
    input: jsonb("input"),
    output: jsonb("output"),
    retries: smallint("retries").notNull().default(0),

    /** Señales de buena vecindad que la vista de Traza expone a propósito. */
    robotsRespected: boolean("robots_respected"),
    requestsPerSecond: doublePrecision("requests_per_second"),
    cacheHits: integer("cache_hits"),
  },
  (t) => [
    /** El orden de la tabla en vivo. */
    index("trace_scan_idx").on(t.scanId, t.startedAt),
    index("trace_prospect_idx").on(t.prospectId),
    /** Filtro "Solo errores". */
    index("trace_errors_idx")
      .on(t.scanId, t.startedAt)
      .where(sql`${t.status} <> 'ok'`),
  ],
);

// ─── Propuestas ──────────────────────────────────────────────────────────────

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    status: proposalStatusEnum("status").notNull().default("draft"),
    language: text("language").notNull().default("es"),
    tone: text("tone").notNull().default("direct"),
    template: text("template").notNull().default("default"),

    recipientPersonId: uuid("recipient_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    recipientName: text("recipient_name").notNull().default(""),
    recipientEmail: text("recipient_email").notNull().default(""),

    subtotalUsd: integer("subtotal_usd").notNull().default(0),
    discountUsd: integer("discount_usd").notNull().default(0),
    totalUsd: integer("total_usd").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    pdfStorageKey: text("pdf_storage_key"),

    /** Detecta el conflicto cuando dos personas editan la misma propuesta. */
    version: integer("version").notNull().default(1),
  },
  (t) => [index("proposals_prospect_idx").on(t.prospectId)],
);

export const proposalBlocks = pgTable(
  "proposal_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    type: proposalBlockTypeEnum("type").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    order: smallint("order").notNull().default(0),
    content: text("content"),
    /** Solo en bloques de hallazgos. */
    findingIds: uuid("finding_ids").array().notNull().default(sql`'{}'`),
    includeScreenshots: boolean("include_screenshots").notNull().default(false),
  },
  (t) => [index("proposal_blocks_proposal_idx").on(t.proposalId, t.order)],
);

export const proposalPhases = pgTable(
  "proposal_phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    branch: branchEnum("branch").notNull(),
    name: text("name").notNull(),
    deliverables: text("deliverables").array().notNull().default(sql`'{}'`),
    priceUsd: integer("price_usd").notNull().default(0),
    weeks: text("weeks").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    order: smallint("order").notNull().default(0),
    /** Hallazgos que esta fase resuelve. */
    findingIds: uuid("finding_ids").array().notNull().default(sql`'{}'`),
  },
  (t) => [index("proposal_phases_proposal_idx").on(t.proposalId, t.order)],
);

// ─── Cola de trabajos ────────────────────────────────────────────────────────
// Cero infraestructura: una tabla + SKIP LOCKED. Si el worker está apagado los
// trabajos esperan y la plataforma sigue mostrando lo ya escaneado.

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "scan.zone", "audit.prospect", "finding.recheck", "proposal.draft". */
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    priority: smallint("priority").notNull().default(0),

    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    attempts: smallint("attempts").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull().default(5),
    /** Retroceso exponencial: el worker recalcula runAfter con esto. */
    lastError: text("last_error"),

    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    scanId: uuid("scan_id").references(() => scans.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").references(() => prospects.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    /** El índice que hace eficiente el FOR UPDATE SKIP LOCKED. */
    index("jobs_claim_idx")
      .on(t.priority.desc(), t.runAfter)
      .where(sql`${t.status} = 'queued'`),
    index("jobs_scan_idx").on(t.scanId),
  ],
);

// ─── Caché de Places ─────────────────────────────────────────────────────────
// La cuota es escasa y visible: cachea details por placeId 30 días y no vuelvas
// a pedir lo que ya tienes.

export const placesCache = pgTable(
  "places_cache",
  {
    placeId: text("place_id").primaryKey(),
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Cuántas veces evitó una llamada. Alimenta cacheHits de la traza. */
    hits: integer("hits").notNull().default(0),
  },
  (t) => [index("places_cache_expires_idx").on(t.expiresAt)],
);

/** Consumo de cuota por mes, para el contador de la cabecera. */
export const quotaUsage = pgTable(
  "quota_usage",
  {
    /** "2026-08" */
    period: text("period").notNull(),
    resource: text("resource").notNull(), // "places" | "llm"
    used: integer("used").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.period, t.resource] })],
);

// ─── Relaciones ──────────────────────────────────────────────────────────────

export const zonesRelations = relations(zones, ({ many }) => ({
  prospects: many(prospects),
  scans: many(scans),
}));

export const scansRelations = relations(scans, ({ one, many }) => ({
  zone: one(zones, { fields: [scans.zoneId], references: [zones.id] }),
  traceSteps: many(traceSteps),
}));

export const prospectsRelations = relations(prospects, ({ one, many }) => ({
  zone: one(zones, { fields: [prospects.zoneId], references: [zones.id] }),
  findings: many(findings),
  people: many(people),
  mentions: many(mentions),
  evidence: many(evidence),
  proposals: many(proposals),
}));

export const findingsRelations = relations(findings, ({ one }) => ({
  prospect: one(prospects, { fields: [findings.prospectId], references: [prospects.id] }),
  evidence: one(evidence, { fields: [findings.evidenceId], references: [evidence.id] }),
}));

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
  prospect: one(prospects, { fields: [evidence.prospectId], references: [prospects.id] }),
  findings: many(findings),
}));

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  prospect: one(prospects, { fields: [proposals.prospectId], references: [prospects.id] }),
  blocks: many(proposalBlocks),
  phases: many(proposalPhases),
}));

export const traceStepsRelations = relations(traceSteps, ({ one }) => ({
  scan: one(scans, { fields: [traceSteps.scanId], references: [scans.id] }),
  prospect: one(prospects, { fields: [traceSteps.prospectId], references: [prospects.id] }),
}));
