/**
 * `scan.zone`: busca los negocios de una zona y encola una auditoría por cada
 * uno.
 *
 * Esto es lo único determinista del proceso, y lo es porque no hay juicio que
 * ejercer: Places devuelve lo que devuelve. Todo lo que sí tiene juicio —si el
 * negocio encaja, qué le falla, cuánto vale— es del agente. Aquí no se filtra
 * por ICP: un negocio fuera del ICP se guarda y se marca, porque el estado
 * vacío de la interfaz tiene que poder desglosar por qué 34 negocios quedaron
 * fuera.
 */

import { eq, sql } from "drizzle-orm";
import { db, enqueue, prospects, scans, zones } from "@borsoga/db";
import type { County, Sector } from "@borsoga/shared";
import { config } from "../config";
import { log } from "../log";
import { recordStep } from "../persist/trace";
import { PlacesError, searchZone, type PlaceSummary } from "../tools/places";

export interface ScanZonePayload {
  scanId: string;
  zoneId: string;
}

const COUNTY_BY_NAME: Record<string, County> = {
  "miami-dade county": "miami_dade",
  "miami dade county": "miami_dade",
  "broward county": "broward",
  "palm beach county": "palm_beach",
};

function componentOf(place: PlaceSummary, type: string): string | null {
  return place.addressComponents?.find((c) => c.types?.includes(type))?.longText ?? null;
}

function countyOf(place: PlaceSummary): County | null {
  const admin2 = componentOf(place, "administrative_area_level_2");
  if (!admin2) return null;
  return COUNTY_BY_NAME[admin2.toLowerCase()] ?? null;
}

export async function scanZone(payload: ScanZonePayload): Promise<void> {
  const { scanId, zoneId } = payload;

  const [zone] = await db.select().from(zones).where(eq(zones.id, zoneId)).limit(1);
  if (!zone) throw new Error(`zona ${zoneId} no existe`);

  await db.update(scans).set({ status: "running" }).where(eq(scans.id, scanId));

  const startedAt = new Date();
  const t0 = performance.now();

  let hits;
  try {
    hits = await searchZone({
      center: { lat: zone.centerLat, lng: zone.centerLng },
      radiusMeters: zone.radiusMeters,
      sectors: zone.sectors as Sector[],
    });
  } catch (err) {
    // El código exacto se muestra al usuario tal cual: "OVER_QUERY_LIMIT" con
    // hora, y dos salidas. Nunca un modal que bloquee.
    const code = err instanceof PlacesError ? err.code : "SEARCH_FAILED";
    const message = err instanceof Error ? err.message : String(err);

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
      step: "places.searchText",
      target: zone.name,
      status: "error",
      startedAt,
      durationMs: Math.round(performance.now() - t0),
      output: { errorCode: code, message: message.slice(0, 500) },
    });

    throw err;
  }

  let queued = 0;
  let outOfArea = 0;
  let skippedByCap = 0;

  for (const { place, sectors } of hits) {
    const county = countyOf(place);
    const name = place.displayName?.text ?? "(sin nombre)";

    if (!county) {
      // Fuera de los tres condados: no es del mercado, ni siquiera se guarda.
      outOfArea += 1;
      log.debug("fuera del área", { name, address: place.formattedAddress });
      continue;
    }

    const [row] = await db
      .insert(prospects)
      .values({
        placeId: place.id,
        name,
        sectors,
        county,
        city: componentOf(place, "locality") ?? componentOf(place, "postal_town") ?? "",
        address: place.formattedAddress ?? "",
        lat: place.location?.latitude ?? zone.centerLat,
        lng: place.location?.longitude ?? zone.centerLng,
        website: place.websiteUri ?? null,
        phone: place.nationalPhoneNumber ?? null,
        ratings:
          place.rating !== undefined
            ? ([{ source: "google", score: place.rating, reviewCount: place.userRatingCount ?? 0 }] as never)
            : ([] as never),
        zoneId,
      })
      .onConflictDoUpdate({
        target: prospects.placeId,
        set: {
          name,
          address: place.formattedAddress ?? "",
          website: place.websiteUri ?? null,
          phone: place.nationalPhoneNumber ?? null,
          // El sector lo afina el agente al auditar; aquí solo se suma la pista.
          sectors: sql`array(select distinct unnest(${prospects.sectors} || ${sectors}::sector[]))`,
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
      progressFound: hits.length,
      progressTotal: queued,
      totalSteps: sql`${scans.totalSteps} + 1`,
    })
    .where(eq(scans.id, scanId));

  await recordStep({
    scanId,
    step: "places.searchText",
    target: zone.name,
    status: "ok",
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    input: {
      center: { lat: zone.centerLat, lng: zone.centerLng },
      radiusMeters: zone.radiusMeters,
      sectors: zone.sectors,
    },
    output: { encontrados: hits.length, encolados: queued, fueraDelArea: outOfArea },
  });

  await db
    .update(zones)
    .set({ lastScanAt: new Date(), lastScanProspects: queued })
    .where(eq(zones.id, zoneId));

  log.info("zona escaneada", { zona: zone.name, encontrados: hits.length, encolados: queued, fueraDelArea: outOfArea });

  // Nada que auditar: el escaneo termina aquí y no se queda colgado en marcha.
  if (queued === 0) {
    await db
      .update(scans)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(scans.id, scanId));
  }
}
