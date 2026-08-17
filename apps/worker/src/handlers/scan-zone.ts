/**
 * `scan.zone`: un run del agente que busca los negocios de una zona y encola
 * una auditoría por cada uno.
 *
 * Antes esto era lo único determinista del proceso, y lo era porque la búsqueda
 * la hacía Places: se pedía un texto por sector y venía lo que viniera. Con el
 * descubrimiento contra Google Maps ya no hay nada determinista que valga —
 * "custom kitchen cabinets", "kitchen remodeler" y "cabinet maker" devuelven
 * listas que apenas se solapan, y elegir los términos, ver cuál rinde y saber
 * cuándo se ha barrido bastante es exactamente el juicio que tiene el agente.
 *
 * Lo que sí sigue siendo determinista es lo de después: guardar, deduplicar por
 * id de la fuente y encolar hasta el tope. Ahí no hay nada que decidir.
 *
 * Aquí no se filtra por ICP: un negocio fuera del ICP se guarda y se marca al
 * auditarlo, porque el estado vacío de la interfaz tiene que poder desglosar
 * por qué 34 negocios quedaron fuera.
 */

import { eq, sql } from "drizzle-orm";
import { db, enqueue, prospects, scans, zones } from "@borsoga/db";
import {
  prospectorOutputJsonSchema,
  type AgentToolCall,
  type AgentToolContext,
  type DiscoveredBusiness,
  type Sector,
} from "@borsoga/shared";
import { config } from "../config";
import { errorMessage, log } from "../log";
import { waitTurn } from "../net/politeness";
import { recordStep, recordToolCall } from "../persist/trace";
import { prospectorPrompt, prospectorSystem } from "../prompts";
import { getProvider } from "../providers";
import { prospectorTools } from "../tools";
import { resetSearchBudget } from "../tools/maps";

export interface ScanZonePayload {
  scanId: string;
  zoneId: string;
}

export async function scanZone(payload: ScanZonePayload, signal: AbortSignal): Promise<void> {
  const { scanId, zoneId } = payload;

  const [zone] = await db.select().from(zones).where(eq(zones.id, zoneId)).limit(1);
  if (!zone) throw new Error(`zona ${zoneId} no existe`);

  await db.update(scans).set({ status: "running" }).where(eq(scans.id, scanId));

  log.info("buscando en zona", { zona: zone.name, scanId });

  // ─── El run ────────────────────────────────────────────────────────────────

  const ctx: AgentToolContext = { scanId, prospectId: null, signal, rateLimit: waitTurn };

  const pendingWrites: Promise<void>[] = [];
  const onStep = (call: AgentToolCall): void => {
    pendingWrites.push(
      recordToolCall({ scanId, prospectId: null, call })
        .then(() => undefined)
        .catch((err) => log.error("no se pudo escribir el paso", { err: errorMessage(err) })),
    );
  };

  const startedAt = new Date();
  const t0 = performance.now();

  let run;
  try {
    run = await getProvider().runAgent({
      system: prospectorSystem,
      prompt: prospectorPrompt({
        zoneName: zone.name,
        county: zone.county,
        centerLat: zone.centerLat,
        centerLng: zone.centerLng,
        radiusMeters: zone.radiusMeters,
        sectors: zone.sectors as Sector[],
        minTicketUsd: zone.minTicketUsd,
        maxBusinesses: config.SCAN_MAX_PROSPECTS,
      }),
      tools: prospectorTools as never,
      ctx,
      schemaName: "ProspectorOutput",
      schema: prospectorOutputJsonSchema,
      maxTurns: config.LLM_MAX_TURNS_ZONE,
      maxCostUsd: config.LLM_MAX_COST_USD_PER_ZONE,
      onStep,
    });
  } catch (err) {
    await Promise.all(pendingWrites);
    await failScan(scanId, "SEARCH_FAILED", errorMessage(err), startedAt, t0, zone.name);
    throw err;
  }

  await Promise.all(pendingWrites);
  resetSearchBudget(scanId);

  const report = run.json as { businesses?: DiscoveredBusiness[]; queries?: string[]; notes?: string } | null;

  await recordStep({
    scanId,
    step: "scan.run",
    target: zone.name,
    status: report ? "ok" : "error",
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    model: run.model,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    input: { zona: zone.name, radio: zone.radiusMeters, sectores: zone.sectors },
    output: report
      ? { encontrados: report.businesses?.length ?? 0, busquedas: report.queries, notas: report.notes }
      : { errorCode: run.stopReason },
  });

  if (!report?.businesses) {
    await failScan(scanId, run.stopReason ?? "NO_REPORT", "el agente no entregó lista de negocios", startedAt, t0, zone.name);
    throw new Error(`el prospector no entregó informe (${run.stopReason})`);
  }

  // ─── Guardar y encolar ─────────────────────────────────────────────────────

  let queued = 0;
  let skippedByCap = 0;
  const seen = new Set<string>();

  for (const business of report.businesses) {
    // Dos entradas con el mismo id son el mismo negocio aunque las trajera una
    // búsqueda distinta. El agente ya debería deduplicar; esto es el cinturón.
    if (seen.has(business.sourceId)) continue;
    seen.add(business.sourceId);

    const [row] = await db
      .insert(prospects)
      .values({
        placeId: business.sourceId,
        name: business.name,
        sectors: business.sectors as never,
        county: business.county,
        city: business.city,
        address: business.address,
        lat: business.lat,
        lng: business.lng,
        website: business.website,
        phone: business.phone,
        ratings:
          business.rating !== null
            ? ([{ source: "google", score: business.rating, reviewCount: business.reviewCount ?? 0 }] as never)
            : ([] as never),
        zoneId,
      })
      .onConflictDoUpdate({
        target: prospects.placeId,
        set: {
          name: business.name,
          address: business.address,
          website: business.website,
          phone: business.phone,
          // El sector lo afina el agente al auditar; aquí solo se suma la pista.
          sectors: sql`array(select distinct unnest(${prospects.sectors} || ${business.sectors}::sector[]))`,
        },
      })
      .returning({ id: prospects.id });

    if (!row) continue;

    /*
     * El freno de gasto. El prospecto ya está guardado, así que no se pierde
     * nada: simplemente no se audita en este escaneo. Sin esto, una zona con
     * cien negocios encolaría cien auditorías y cada una puede costar hasta
     * `LLM_MAX_COST_USD_PER_PROSPECT`.
     */
    if (queued >= config.SCAN_MAX_PROSPECTS) {
      skippedByCap += 1;
      continue;
    }

    await enqueue(db, "audit.prospect", { scanId, prospectId: row.id }, { scanId, prospectId: row.id });
    queued += 1;
  }

  if (skippedByCap > 0) {
    log.warn("tope de auditorías alcanzado", {
      zona: zone.name,
      auditados: queued,
      guardadosSinAuditar: skippedByCap,
      tope: config.SCAN_MAX_PROSPECTS,
    });
  }

  await db
    .update(scans)
    .set({
      progressFound: seen.size,
      progressTotal: queued,
      totalSteps: sql`${scans.totalSteps} + 1`,
    })
    .where(eq(scans.id, scanId));

  await db
    .update(zones)
    .set({ lastScanAt: new Date(), lastScanProspects: queued })
    .where(eq(zones.id, zoneId));

  log.info("zona escaneada", {
    zona: zone.name,
    encontrados: seen.size,
    encolados: queued,
    busquedas: report.queries?.length ?? 0,
  });

  // Nada que auditar: el escaneo termina aquí y no se queda colgado en marcha.
  if (queued === 0) {
    await db
      .update(scans)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(scans.id, scanId));
  }
}

/**
 * El código exacto se muestra al usuario tal cual —"BLOCKED" con hora, y dos
 * salidas— en vez de un modal que bloquee. Un escaneo que falla tiene que decir
 * qué le pasó, porque casi siempre se arregla desde fuera del programa.
 */
async function failScan(
  scanId: string,
  code: string,
  message: string,
  startedAt: Date,
  t0: number,
  zoneName: string,
): Promise<void> {
  await db
    .update(scans)
    .set({
      status: code === "OVER_QUERY_LIMIT" ? "quota_exceeded" : "failed",
      errorCode: code,
      errorMessage: message.slice(0, 2_000),
      finishedAt: new Date(),
    })
    .where(eq(scans.id, scanId));

  await recordStep({
    scanId,
    step: "scan.run",
    target: zoneName,
    status: "error",
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    output: { errorCode: code, message: message.slice(0, 500) },
  });
}
