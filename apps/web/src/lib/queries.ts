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
  proposals as proposalsTable,
  prospects as prospectsTable,
  quotaUsage,
  scans,
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
