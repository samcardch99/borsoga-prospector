/**
 * Lecturas de la plataforma. Todas de solo lectura y todas en el servidor.
 *
 * La web nunca habla con el modelo (handoff §10.2): lee lo que el worker dejó
 * escrito. Si el worker está apagado esto sigue devolviendo lo ya escaneado,
 * que es exactamente lo que la interfaz tiene que mostrar.
 *
 * Cada función va envuelta en `cache()` de React: dentro de una misma petición,
 * la lista y el expediente piden el mismo prospecto y no queremos dos viajes.
 * El ámbito es la petición, así que no hay estado compartido entre usuarios.
 */

import { cache } from "react";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  evidence as evidenceTable,
  findings as findingsTable,
  jobs,
  proposals as proposalsTable,
  prospects as prospectsTable,
  quotaUsage,
  scans,
  traceSteps,
  zones,
} from "@borsoga/db";
import type {
  Branch,
  County,
  DisqualifyReason,
  Sector,
  Severity,
  Verdict,
} from "@borsoga/shared";
import { screenshotKeyOf } from "./trace-output";

// ─── Formas que consume la interfaz ──────────────────────────────────────────

/** Una fila de la lista izquierda y un marcador del mapa: la misma entidad. */
export interface ProspectRow {
  id: string;
  name: string;
  city: string;
  sectors: Sector[];
  lat: number;
  lng: number;
  score: number;
  ticketEstimate: number;
  branchScores: Partial<Record<Branch, number>>;
  /** Hallazgos por rama. Alimenta las insignias R / W / B de la fila. */
  branchCounts: Partial<Record<Branch, number>>;
  icpFit: "high" | "medium" | "low";
  disqualified: boolean;
  disqualifyReason: DisqualifyReason | null;
  disqualifyNote: string | null;
  /** Un prospecto sin tocar por comercial sigue en `detected`. */
  contacted: boolean;
}

export interface DossierFinding {
  id: string;
  branch: Branch;
  severity: Severity;
  verdict: Verdict;
  title: string;
  evidenceUrl: string;
}

/** El expediente resumido de la columna derecha (handoff §6.1). */
export interface Dossier {
  id: string;
  name: string;
  address: string;
  city: string;
  website: string | null;
  score: number;
  ticketEstimate: number;
  employeesEstimate: number | null;
  icpFit: "high" | "medium" | "low";
  growthSignals: string[];
  disqualified: boolean;
  disqualifyNote: string | null;
  ratings: Array<{ source: string; score: number; reviewCount: number }>;
  branchScores: Partial<Record<Branch, number>>;
  branchTickets: Partial<Record<Branch, number>>;
  findings: DossierFinding[];
}

export interface ZoneSummary {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  sectors: Sector[];
  minTicketUsd: number;
  lastScanAt: Date | null;
}

export interface ScanSummary {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "quota_exceeded" | "cancelled";
  startedAt: Date;
  progressFound: number;
  progressAudited: number;
  progressTotal: number;
  progressDisqualified: number;
  totalCostUsd: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface QuotaSummary {
  used: number;
  limit: number;
  costUsd: number;
}

// ─── Consultas ───────────────────────────────────────────────────────────────

/**
 * La zona que se está mirando. Sin selector de zona todavía (es el paso 8), así
 * que se coge la activa más reciente; si no hay ninguna activa, la que haya.
 */
export const getZone = cache(async (zoneId?: string): Promise<ZoneSummary | null> => {
  const rows = await db
    .select({
      id: zones.id,
      name: zones.name,
      centerLat: zones.centerLat,
      centerLng: zones.centerLng,
      radiusMeters: zones.radiusMeters,
      sectors: zones.sectors,
      minTicketUsd: zones.minTicketUsd,
      lastScanAt: zones.lastScanAt,
      active: zones.active,
    })
    .from(zones)
    .where(zoneId ? eq(zones.id, zoneId) : undefined)
    .orderBy(desc(zones.active), desc(zones.createdAt))
    .limit(1);

  const zone = rows[0];
  if (!zone) return null;

  return {
    id: zone.id,
    name: zone.name,
    centerLat: zone.centerLat,
    centerLng: zone.centerLng,
    radiusMeters: zone.radiusMeters,
    sectors: zone.sectors,
    minTicketUsd: zone.minTicketUsd,
    lastScanAt: zone.lastScanAt,
  };
});

/**
 * Los prospectos de una zona, con el recuento de hallazgos por rama.
 *
 * Se traen también los descartados: la lista los pinta al 55 % con su motivo y
 * el equipo los necesita para corregir los filtros (handoff §5). Filtrarlos
 * aquí obligaría a una segunda consulta para el chip "Descartados".
 *
 * Dos viajes a propósito. Un solo `group by` con left join devuelve una fila
 * por (prospecto, rama) y hay que recomponerlo igual; así se lee mejor y las
 * dos consultas van por índice.
 */
export const listProspects = cache(async (zoneId: string): Promise<ProspectRow[]> => {
  const rows = await db
    .select({
      id: prospectsTable.id,
      name: prospectsTable.name,
      city: prospectsTable.city,
      sectors: prospectsTable.sectors,
      lat: prospectsTable.lat,
      lng: prospectsTable.lng,
      score: prospectsTable.score,
      ticketEstimate: prospectsTable.ticketEstimate,
      branchScores: prospectsTable.branchScores,
      icpFit: prospectsTable.icpFit,
      disqualified: prospectsTable.disqualified,
      disqualifyReason: prospectsTable.disqualifyReason,
      disqualifyNote: prospectsTable.disqualifyNote,
      stage: prospectsTable.stage,
    })
    .from(prospectsTable)
    .where(eq(prospectsTable.zoneId, zoneId))
    .orderBy(desc(prospectsTable.score));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      prospectId: findingsTable.prospectId,
      branch: findingsTable.branch,
      n: sql<number>`count(*)::int`,
    })
    .from(findingsTable)
    .where(
      inArray(
        findingsTable.prospectId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(findingsTable.prospectId, findingsTable.branch);

  const byProspect = new Map<string, Partial<Record<Branch, number>>>();
  for (const c of counts) {
    const entry = byProspect.get(c.prospectId) ?? {};
    entry[c.branch] = c.n;
    byProspect.set(c.prospectId, entry);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    sectors: r.sectors,
    lat: r.lat,
    lng: r.lng,
    score: r.score,
    ticketEstimate: r.ticketEstimate,
    branchScores: (r.branchScores ?? {}) as Partial<Record<Branch, number>>,
    branchCounts: byProspect.get(r.id) ?? {},
    icpFit: r.icpFit,
    disqualified: r.disqualified,
    disqualifyReason: r.disqualifyReason,
    disqualifyNote: r.disqualifyNote,
    contacted: r.stage !== "detected",
  }));
});

/**
 * El expediente resumido. Trae todos los hallazgos ordenados por severidad; la
 * columna derecha corta a tres por rama, pero el recuento por rama tiene que
 * ser el real, no el de los que caben.
 */
export const getDossier = cache(async (prospectId: string): Promise<Dossier | null> => {
  const rows = await db
    .select()
    .from(prospectsTable)
    .where(eq(prospectsTable.id, prospectId))
    .limit(1);

  const p = rows[0];
  if (!p) return null;

  const found = await db
    .select({
      id: findingsTable.id,
      branch: findingsTable.branch,
      severity: findingsTable.severity,
      verdict: findingsTable.verdict,
      title: findingsTable.title,
      evidenceUrl: evidenceTable.url,
    })
    .from(findingsTable)
    .innerJoin(evidenceTable, eq(findingsTable.evidenceId, evidenceTable.id))
    .where(eq(findingsTable.prospectId, prospectId))
    .orderBy(
      // El orden del enum de Postgres ya es critical → low, así que sirve.
      findingsTable.severity,
      desc(findingsTable.detectedAt),
    );

  return {
    id: p.id,
    name: p.name,
    address: p.address,
    city: p.city,
    website: p.website,
    score: p.score,
    ticketEstimate: p.ticketEstimate,
    employeesEstimate: p.employeesEstimate,
    icpFit: p.icpFit,
    growthSignals: p.growthSignals,
    disqualified: p.disqualified,
    disqualifyNote: p.disqualifyNote,
    ratings: (p.ratings ?? []) as Dossier["ratings"],
    branchScores: (p.branchScores ?? {}) as Partial<Record<Branch, number>>,
    branchTickets: (p.branchTickets ?? {}) as Partial<Record<Branch, number>>,
    findings: found,
  };
});

/** La evidencia entera de un hallazgo, tal y como la pide el handoff §6.2. */
export interface FullEvidence {
  url: string;
  quote: string;
  layer: "served_html" | "rendered_dom" | "both_equal" | "mismatch" | "external_source";
  method: string;
  capturedAt: Date;
  screenshotStorageKey: string | null;
  screenshotWidth: number | null;
  screenshotHeight: number | null;
  screenshotTakenAt: Date | null;
}

export interface FullFinding extends DossierFinding {
  description: string;
  clientGain: string;
  verifiedAt: Date;
  recheckCount: number;
  reviewNote: string | null;
  evidence: FullEvidence;
}

export interface FullDossier extends Dossier {
  sectors: Sector[];
  county: County;
  phone: string | null;
  commercialViability: string;
  lastScannedAt: Date;
  stage: string;
  fullFindings: FullFinding[];
}

/**
 * El expediente completo. Es la misma entidad que `getDossier` pero con la
 * evidencia entera —cita, capa, método, captura— que el resumen no necesita y
 * que aquí es el contenido principal de la pantalla.
 */
export const getFullDossier = cache(async (prospectId: string): Promise<FullDossier | null> => {
  const base = await getDossier(prospectId);
  if (!base) return null;

  const rows = await db
    .select()
    .from(prospectsTable)
    .where(eq(prospectsTable.id, prospectId))
    .limit(1);

  const p = rows[0];
  if (!p) return null;

  const found = await db
    .select({
      id: findingsTable.id,
      branch: findingsTable.branch,
      severity: findingsTable.severity,
      verdict: findingsTable.verdict,
      title: findingsTable.title,
      description: findingsTable.description,
      clientGain: findingsTable.clientGain,
      verifiedAt: findingsTable.verifiedAt,
      recheckCount: findingsTable.recheckCount,
      reviewNote: findingsTable.reviewNote,
      evidenceUrl: evidenceTable.url,
      quote: evidenceTable.quote,
      layer: evidenceTable.layer,
      method: evidenceTable.method,
      capturedAt: evidenceTable.capturedAt,
      screenshotStorageKey: evidenceTable.screenshotStorageKey,
      screenshotWidth: evidenceTable.screenshotWidth,
      screenshotHeight: evidenceTable.screenshotHeight,
      screenshotTakenAt: evidenceTable.screenshotTakenAt,
    })
    .from(findingsTable)
    .innerJoin(evidenceTable, eq(findingsTable.evidenceId, evidenceTable.id))
    .where(eq(findingsTable.prospectId, prospectId))
    .orderBy(findingsTable.severity, desc(findingsTable.detectedAt));

  return {
    ...base,
    sectors: p.sectors,
    county: p.county,
    phone: p.phone,
    commercialViability: p.commercialViability,
    lastScannedAt: p.lastScannedAt,
    stage: p.stage,
    fullFindings: found.map((f) => ({
      id: f.id,
      branch: f.branch,
      severity: f.severity,
      verdict: f.verdict,
      title: f.title,
      evidenceUrl: f.evidenceUrl,
      description: f.description,
      clientGain: f.clientGain,
      verifiedAt: f.verifiedAt,
      recheckCount: f.recheckCount,
      reviewNote: f.reviewNote,
      evidence: {
        url: f.evidenceUrl,
        quote: f.quote,
        layer: f.layer,
        method: f.method,
        capturedAt: f.capturedAt,
        screenshotStorageKey: f.screenshotStorageKey,
        screenshotWidth: f.screenshotWidth,
        screenshotHeight: f.screenshotHeight,
        screenshotTakenAt: f.screenshotTakenAt,
      },
    })),
  };
});

/** Los tres estados del filtro de la cola de revisión (handoff §6.3). */
export type ReviewFilter = "pendientes" | "matizados" | "todos";

export interface ReviewItem extends FullFinding {
  prospectId: string;
  prospectName: string;
  prospectCity: string;
}

/**
 * La cola de revisión: los hallazgos que esperan juicio humano.
 *
 * Orden por antigüedad, no por severidad. La IA propone y un humano decide, y
 * lo que no se puede permitir es que un hallazgo se quede indefinidamente sin
 * mirar porque siempre entran otros más graves por delante.
 */
export const listReviewQueue = cache(
  async (filter: ReviewFilter = "pendientes"): Promise<ReviewItem[]> => {
    const verdicts =
      filter === "pendientes"
        ? (["pending"] as const)
        : filter === "matizados"
          ? (["nuanced"] as const)
          : (["pending", "nuanced", "confirmed", "discarded"] as const);

    const rows = await db
      .select({
        id: findingsTable.id,
        branch: findingsTable.branch,
        severity: findingsTable.severity,
        verdict: findingsTable.verdict,
        title: findingsTable.title,
        description: findingsTable.description,
        clientGain: findingsTable.clientGain,
        verifiedAt: findingsTable.verifiedAt,
        recheckCount: findingsTable.recheckCount,
        reviewNote: findingsTable.reviewNote,
        prospectId: prospectsTable.id,
        prospectName: prospectsTable.name,
        prospectCity: prospectsTable.city,
        evidenceUrl: evidenceTable.url,
        quote: evidenceTable.quote,
        layer: evidenceTable.layer,
        method: evidenceTable.method,
        capturedAt: evidenceTable.capturedAt,
        screenshotStorageKey: evidenceTable.screenshotStorageKey,
        screenshotWidth: evidenceTable.screenshotWidth,
        screenshotHeight: evidenceTable.screenshotHeight,
        screenshotTakenAt: evidenceTable.screenshotTakenAt,
      })
      .from(findingsTable)
      .innerJoin(evidenceTable, eq(findingsTable.evidenceId, evidenceTable.id))
      .innerJoin(prospectsTable, eq(findingsTable.prospectId, prospectsTable.id))
      .where(inArray(findingsTable.verdict, [...verdicts]))
      .orderBy(findingsTable.detectedAt);

    return rows.map((f) => ({
      id: f.id,
      branch: f.branch,
      severity: f.severity,
      verdict: f.verdict,
      title: f.title,
      evidenceUrl: f.evidenceUrl,
      description: f.description,
      clientGain: f.clientGain,
      verifiedAt: f.verifiedAt,
      recheckCount: f.recheckCount,
      reviewNote: f.reviewNote,
      prospectId: f.prospectId,
      prospectName: f.prospectName,
      prospectCity: f.prospectCity,
      evidence: {
        url: f.evidenceUrl,
        quote: f.quote,
        layer: f.layer,
        method: f.method,
        capturedAt: f.capturedAt,
        screenshotStorageKey: f.screenshotStorageKey,
        screenshotWidth: f.screenshotWidth,
        screenshotHeight: f.screenshotHeight,
        screenshotTakenAt: f.screenshotTakenAt,
      },
    }));
  },
);

/** Cuántos hallazgos se han revisado hoy. Va en el pie del rail derecho. */
export const getReviewedToday = cache(async (): Promise<number> => {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(findingsTable)
    .where(sql`${findingsTable.reviewedAt} >= date_trunc('day', now())`);

  return rows[0]?.n ?? 0;
});

// ─── Auditoría en vivo ───────────────────────────────────────────────────────

export interface LiveStep {
  id: string;
  step: string;
  target: string;
  status: TraceStatus;
  startedAt: Date;
  durationMs: number;
}

/** Una auditoría en curso, con lo necesario para pintar su ventana en vivo. */
export interface LiveRun {
  prospectId: string;
  prospectName: string;
  lat: number;
  lng: number;
  startedAt: Date;
  steps: LiveStep[];
  /** Última captura que dejó el agente, si dejó alguna. */
  screenshotKey: string | null;
  /** Lo último que miró: alimenta la línea de URL del panel. */
  currentTarget: string | null;
}

/**
 * Las auditorías que están corriendo ahora mismo.
 *
 * Sale de `jobs`, no de `scans`: el escaneo puede estar en marcha con todos sus
 * prospectos esperando en cola, y lo que la ventana en vivo quiere enseñar es
 * dónde hay alguien trabajando de verdad. Con `WORKER_CONCURRENCY=2` son dos
 * como mucho, y el usuario elige cuál mira.
 */
export const listLiveRuns = cache(async (): Promise<LiveRun[]> => {
  const running = await db
    .select({
      prospectId: prospectsTable.id,
      prospectName: prospectsTable.name,
      lat: prospectsTable.lat,
      lng: prospectsTable.lng,
      startedAt: jobs.lockedAt,
    })
    .from(jobs)
    .innerJoin(prospectsTable, eq(jobs.prospectId, prospectsTable.id))
    .where(and(eq(jobs.kind, "audit.prospect"), eq(jobs.status, "running")))
    .orderBy(jobs.lockedAt);

  if (running.length === 0) return [];

  const ids = running.map((r) => r.prospectId);

  /* Los pasos de todos los runs en una consulta, no una por run: son dos
     ventanas como mucho, pero el patrón aguanta si sube la concurrencia. */
  const steps = await db
    .select({
      id: traceSteps.id,
      prospectId: traceSteps.prospectId,
      step: traceSteps.step,
      target: traceSteps.target,
      status: traceSteps.status,
      startedAt: traceSteps.startedAt,
      durationMs: traceSteps.durationMs,
      output: traceSteps.output,
    })
    .from(traceSteps)
    .where(inArray(traceSteps.prospectId, ids))
    .orderBy(desc(traceSteps.startedAt))
    .limit(60);

  /*
   * La captura sale del paso de traza, no de `evidence`: la evidencia no
   * existe hasta que el agente entrega el informe, y para entonces el run ya
   * no está corriendo y esta consulta no lo devuelve. El worker anota la clave
   * en el `output` del paso justo cuando guarda la imagen.
   */
  return running.map((r) => {
    const rows = steps.filter((s) => s.prospectId === r.prospectId);
    const mine = rows.map((s) => ({
      id: s.id,
      step: s.step,
      target: s.target,
      status: s.status,
      startedAt: s.startedAt,
      durationMs: s.durationMs,
    }));

    return {
      prospectId: r.prospectId,
      prospectName: r.prospectName,
      lat: r.lat,
      lng: r.lng,
      startedAt: r.startedAt ?? new Date(),
      steps: mine,
      // `rows` viene en orden descendente, así que la primera con imagen es la
      // última que se tomó: la ventana enseña lo que el agente mira ahora.
      screenshotKey: rows.map((s) => screenshotKeyOf(s.output)).find(Boolean) ?? null,
      currentTarget: mine[0]?.target ?? null,
    };
  });
});

// ─── Traza ───────────────────────────────────────────────────────────────────

export type TraceFilter = "todos" | "errores" | "ia";

export type TraceStatus = "ok" | "retry" | "error" | "timeout" | "http_404" | "skipped";

export interface TraceStepRow {
  id: string;
  step: string;
  target: string;
  status: TraceStatus;
  startedAt: Date;
  durationMs: number;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number;
  retries: number;
  robotsRespected: boolean | null;
  requestsPerSecond: number | null;
  cacheHits: number | null;
  input: unknown;
  output: unknown;
  prospectName: string | null;
}

export interface TraceScan extends ScanSummary {
  zoneName: string;
  totalSteps: number;
  totalTokens: number;
  totalErrors: number;
  finishedAt: Date | null;
}

/** El escaneo que se está mirando: el pedido, o el más reciente que haya. */
export const getTraceScan = cache(async (scanId?: string): Promise<TraceScan | null> => {
  const rows = await db
    .select({ scan: scans, zoneName: zones.name })
    .from(scans)
    .innerJoin(zones, eq(scans.zoneId, zones.id))
    .where(scanId ? eq(scans.id, scanId) : undefined)
    .orderBy(desc(scans.startedAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const s = row.scan;

  return {
    id: s.id,
    zoneName: row.zoneName,
    status: s.status,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    progressFound: s.progressFound,
    progressAudited: s.progressAudited,
    progressTotal: s.progressTotal,
    progressDisqualified: s.progressDisqualified,
    totalCostUsd: Number(s.totalCostUsd),
    totalSteps: s.totalSteps,
    totalTokens: s.totalTokens,
    totalErrors: s.totalErrors,
    errorCode: s.errorCode,
    errorMessage: s.errorMessage,
  };
});

/**
 * Los pasos de un escaneo, en el orden en que ocurrieron.
 *
 * Con el enfoque agéntico cada fila es una llamada que la IA **decidió** hacer,
 * no un paso de una receta fija. Por eso el orden es cronológico y no hay
 * agrupación por fases: la secuencia es el dato.
 */
export const listTraceSteps = cache(
  async (scanId: string, filter: TraceFilter = "todos"): Promise<TraceStepRow[]> => {
    const where =
      filter === "errores"
        ? and(eq(traceSteps.scanId, scanId), sql`${traceSteps.status} <> 'ok'`)
        : filter === "ia"
          ? and(eq(traceSteps.scanId, scanId), sql`${traceSteps.model} is not null`)
          : eq(traceSteps.scanId, scanId);

    const rows = await db
      .select({
        id: traceSteps.id,
        step: traceSteps.step,
        target: traceSteps.target,
        status: traceSteps.status,
        startedAt: traceSteps.startedAt,
        durationMs: traceSteps.durationMs,
        model: traceSteps.model,
        tokensIn: traceSteps.tokensIn,
        tokensOut: traceSteps.tokensOut,
        costUsd: traceSteps.costUsd,
        retries: traceSteps.retries,
        robotsRespected: traceSteps.robotsRespected,
        requestsPerSecond: traceSteps.requestsPerSecond,
        cacheHits: traceSteps.cacheHits,
        input: traceSteps.input,
        output: traceSteps.output,
        prospectName: prospectsTable.name,
      })
      .from(traceSteps)
      .leftJoin(prospectsTable, eq(traceSteps.prospectId, prospectsTable.id))
      .where(where)
      .orderBy(traceSteps.startedAt);

    return rows.map((r) => ({ ...r, costUsd: Number(r.costUsd) }));
  },
);

// ─── Pipeline ────────────────────────────────────────────────────────────────

export type PipelineStage =
  | "detected"
  | "reviewed"
  | "proposal_sent"
  | "meeting"
  | "won"
  | "lost";

export interface PipelineCard {
  id: string;
  name: string;
  city: string;
  sectors: Sector[];
  score: number;
  ticketEstimate: number;
  stage: PipelineStage;
  lastActivityAt: Date | null;
  firstSeenAt: Date;
}

export interface PipelineMetrics {
  inPipeline: number;
  openValueUsd: number;
  activeProposals: number;
  wonThisQuarter: number;
  wonValueUsd: number;
}

/** Todo lo que entra en el kanban: los prospectos no descartados. */
export const listPipeline = cache(async (): Promise<PipelineCard[]> => {
  const rows = await db
    .select({
      id: prospectsTable.id,
      name: prospectsTable.name,
      city: prospectsTable.city,
      sectors: prospectsTable.sectors,
      score: prospectsTable.score,
      ticketEstimate: prospectsTable.ticketEstimate,
      stage: prospectsTable.stage,
      lastActivityAt: prospectsTable.lastActivityAt,
      firstSeenAt: prospectsTable.firstSeenAt,
    })
    .from(prospectsTable)
    .where(eq(prospectsTable.disqualified, false))
    .orderBy(desc(prospectsTable.score));

  return rows;
});

/**
 * Las cinco cifras de la barra superior.
 *
 * "Valor abierto" excluye ganados y perdidos a propósito: es lo que sigue vivo,
 * no lo que pasó por aquí. Una barra que suma lo cerrado infla el número justo
 * cuando más se mira.
 */
export const getPipelineMetrics = cache(async (): Promise<PipelineMetrics> => {
  const cards = await listPipeline();
  const open = cards.filter((c) => c.stage !== "won" && c.stage !== "lost");

  const [proposalRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(proposalsTable)
    .where(sql`${proposalsTable.status} <> 'rejected'`);

  const quarterStart = new Date();
  quarterStart.setMonth(Math.floor(quarterStart.getMonth() / 3) * 3, 1);
  quarterStart.setHours(0, 0, 0, 0);

  const won = cards.filter(
    (c) => c.stage === "won" && (c.lastActivityAt ?? c.firstSeenAt) >= quarterStart,
  );

  return {
    inPipeline: open.length,
    openValueUsd: open.reduce((sum, c) => sum + c.ticketEstimate, 0),
    activeProposals: proposalRow?.n ?? 0,
    wonThisQuarter: won.length,
    wonValueUsd: won.reduce((sum, c) => sum + c.ticketEstimate, 0),
  };
});

// ─── Zonas ───────────────────────────────────────────────────────────────────

export interface ZoneRow extends ZoneSummary {
  county: County;
  schedule: string | null;
  active: boolean;
  lastScanProspects: number | null;
  lastScanCostUsd: number | null;
  prospectCount: number;
}

/** La tabla de la vista de Zonas, con el recuento real de cada una. */
export const listZones = cache(async (): Promise<ZoneRow[]> => {
  const rows = await db
    .select({
      id: zones.id,
      name: zones.name,
      county: zones.county,
      centerLat: zones.centerLat,
      centerLng: zones.centerLng,
      radiusMeters: zones.radiusMeters,
      sectors: zones.sectors,
      minTicketUsd: zones.minTicketUsd,
      schedule: zones.schedule,
      active: zones.active,
      lastScanAt: zones.lastScanAt,
      lastScanProspects: zones.lastScanProspects,
      lastScanCostUsd: zones.lastScanCostUsd,
    })
    .from(zones)
    .orderBy(desc(zones.active), zones.name);

  /*
   * El recuento va aparte y no como subconsulta correlacionada dentro del
   * `select`: esa forma devolvía 0 con datos que sí existían. Dos consultas y
   * un `Map` es el mismo patrón que usa `listProspects`, y este sí se puede
   * comprobar de un vistazo.
   */
  const counts = await db
    .select({ zoneId: prospectsTable.zoneId, n: sql<number>`count(*)::int` })
    .from(prospectsTable)
    .groupBy(prospectsTable.zoneId);

  const byZone = new Map(counts.map((c) => [c.zoneId, c.n]));

  return rows.map((z) => ({
    ...z,
    lastScanCostUsd: z.lastScanCostUsd === null ? null : Number(z.lastScanCostUsd),
    prospectCount: byZone.get(z.id) ?? 0,
  }));
});

/** El escaneo más reciente de la zona: alimenta el panel de progreso y la hora. */
export const getLatestScan = cache(async (zoneId: string): Promise<ScanSummary | null> => {
  const rows = await db
    .select()
    .from(scans)
    .where(eq(scans.zoneId, zoneId))
    .orderBy(desc(scans.startedAt))
    .limit(1);

  const s = rows[0];
  if (!s) return null;

  return {
    id: s.id,
    status: s.status,
    startedAt: s.startedAt,
    progressFound: s.progressFound,
    progressAudited: s.progressAudited,
    progressTotal: s.progressTotal,
    progressDisqualified: s.progressDisqualified,
    totalCostUsd: Number(s.totalCostUsd),
    errorCode: s.errorCode,
    errorMessage: s.errorMessage,
  };
});

/**
 * Los contadores de la barra de pestañas. Son datos reales desde el primer día
 * a propósito: un contador inventado en la navegación es la clase de detalle
 * que luego nadie recuerda que era falso.
 */
export const getNavCounts = cache(
  async (): Promise<{ review: number; proposals: number; pipeline: number }> => {
    const [review, proposals, pipeline] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(findingsTable)
        .where(eq(findingsTable.verdict, "pending")),
      db.select({ n: sql<number>`count(*)::int` }).from(proposalsTable),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(prospectsTable)
        .where(sql`${prospectsTable.stage} <> 'detected'`),
    ]);

    return {
      review: review[0]?.n ?? 0,
      proposals: proposals[0]?.n ?? 0,
      pipeline: pipeline[0]?.n ?? 0,
    };
  },
);

/**
 * Cuota de Places del mes en curso. La cabecera la muestra porque es un recurso
 * escaso y visible (handoff §10.3), no como adorno.
 */
export const getQuota = cache(async (): Promise<QuotaSummary> => {
  const period = new Date().toISOString().slice(0, 7); // "2026-08"
  const limit = Number(process.env.PLACES_MONTHLY_LIMIT ?? 10_000);

  const rows = await db
    .select({ used: quotaUsage.used, costUsd: quotaUsage.costUsd })
    .from(quotaUsage)
    .where(and(eq(quotaUsage.period, period), eq(quotaUsage.resource, "places")))
    .limit(1);

  const row = rows[0];
  return {
    used: row?.used ?? 0,
    limit,
    costUsd: Number(row?.costUsd ?? 0),
  };
});
