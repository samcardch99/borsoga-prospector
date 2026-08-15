/**
 * Google Places (API New, v1).
 *
 * La cuota es el único coste real y visible del producto, así que aquí se
 * concentran las tres reglas del handoff §10.3: cachear `details` por
 * `placeId` 30 días, contar lo que se gasta en `quota_usage`, y no volver a
 * pedir lo que ya se tiene.
 */

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, placesCache, quotaUsage } from "@borsoga/db";
import type { AgentTool, Sector, ToolResult } from "@borsoga/shared";
import { config, requirePlacesKey } from "../config";
import { errorMessage, log } from "../log";
import { clip, observe } from "./observation";

const BASE = "https://places.googleapis.com/v1";

const DETAILS_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "addressComponents",
  "location",
  "websiteUri",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "rating",
  "userRatingCount",
  "reviews",
  "types",
  "primaryType",
  "businessStatus",
  "regularOpeningHours",
  "editorialSummary",
  "googleMapsUri",
].join(",");

const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.primaryType",
  "places.businessStatus",
  "nextPageToken",
].join(",");

export interface PlaceSummary {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
}

/** Términos de búsqueda por sector. Places no tiene un tipo para casi ninguno. */
const SECTOR_QUERY: Record<Sector, string> = {
  construction: "general contractor construction company",
  remodeling: "home remodeling contractor",
  real_estate_development: "real estate developer",
  modular_homes: "modular home builder prefab homes",
  closets: "custom closets closet design",
  kitchens: "custom kitchen design kitchen remodeling",
  millwork: "architectural millwork woodworking",
  cabinetry: "custom cabinetry cabinet maker",
  interior_design: "interior design studio",
};

async function countQuota(used: number): Promise<void> {
  const period = new Date().toISOString().slice(0, 7); // "2026-08"
  await db
    .insert(quotaUsage)
    .values({ period, resource: "places", used })
    .onConflictDoUpdate({
      target: [quotaUsage.period, quotaUsage.resource],
      set: { used: sql`${quotaUsage.used} + ${used}`, updatedAt: new Date() },
    });
}

/** Sube el error de cuota tal cual: la interfaz muestra el código exacto. */
class PlacesError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlacesError";
  }
}

export { PlacesError };

async function placesFetch<T>(
  path: string,
  fieldMask: string,
  init?: { method: string; body: unknown },
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "X-Goog-Api-Key": requirePlacesKey(),
      "X-Goog-FieldMask": fieldMask,
      "Content-Type": "application/json",
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text();
    const code =
      res.status === 429
        ? "OVER_QUERY_LIMIT"
        : res.status === 403
          ? "REQUEST_DENIED"
          : `HTTP_${res.status}`;
    throw new PlacesError(code, clip(text, 500));
  }

  await countQuota(1);
  return (await res.json()) as T;
}

// ─── Búsqueda de una zona ────────────────────────────────────────────────────

export interface ZoneSearchArgs {
  center: { lat: number; lng: number };
  radiusMeters: number;
  sectors: readonly Sector[];
}

export interface ZoneSearchHit {
  place: PlaceSummary;
  /** Sectores cuya búsqueda lo encontró. Es una pista, no un veredicto. */
  sectors: Sector[];
}

/**
 * Un `searchText` por sector, acotado al círculo de la zona. Se usa texto y no
 * `searchNearby` porque los tipos de Places no distinguen "cabinetry" de
 * "furniture store", y ese matiz es justo el ICP.
 *
 * Qué sector encontró a cada negocio se conserva como pista para el agente; el
 * sector definitivo lo decide él al auditar, no esta consulta.
 */
export async function searchZone(args: ZoneSearchArgs): Promise<ZoneSearchHit[]> {
  const byId = new Map<string, ZoneSearchHit>();

  for (const sector of args.sectors) {
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const body: Record<string, unknown> = {
        textQuery: SECTOR_QUERY[sector],
        locationBias: {
          circle: {
            center: { latitude: args.center.lat, longitude: args.center.lng },
            radius: Math.min(args.radiusMeters, 50_000),
          },
        },
        maxResultCount: 20,
        ...(pageToken ? { pageToken } : {}),
      };

      const page = await placesFetch<{ places?: PlaceSummary[]; nextPageToken?: string }>(
        "/places:searchText",
        SEARCH_FIELDS,
        { method: "POST", body },
      );

      for (const place of page.places ?? []) {
        if (!place.id) continue;
        const hit = byId.get(place.id);
        if (hit) {
          if (!hit.sectors.includes(sector)) hit.sectors.push(sector);
        } else {
          byId.set(place.id, { place, sectors: [sector] });
        }
      }

      pageToken = page.nextPageToken;
      pages += 1;
    } while (pageToken && pages < 3);

    log.debug("sector buscado", { sector, acumulado: byId.size });
  }

  return [...byId.values()];
}

// ─── Herramienta del agente ──────────────────────────────────────────────────

const inputSchema = {
  placeId: z.string().describe("placeId de Google del negocio, tal como aparece en el prospecto"),
};

type Input = { placeId: string };

async function readCache(placeId: string): Promise<PlaceSummary | null> {
  const [row] = await db
    .select()
    .from(placesCache)
    .where(and(eq(placesCache.placeId, placeId), sql`${placesCache.expiresAt} > now()`))
    .limit(1);

  if (!row) return null;

  await db
    .update(placesCache)
    .set({ hits: sql`${placesCache.hits} + 1` })
    .where(eq(placesCache.placeId, placeId));

  return row.payload as PlaceSummary;
}

async function writeCache(placeId: string, payload: unknown): Promise<void> {
  const expiresAt = new Date(Date.now() + config.PLACES_CACHE_TTL_DAYS * 86_400_000);
  await db
    .insert(placesCache)
    .values({ placeId, payload: payload as never, expiresAt })
    .onConflictDoUpdate({
      target: placesCache.placeId,
      set: { payload: payload as never, fetchedAt: new Date(), expiresAt },
    });
}

export const placesDetailsTool: AgentTool<Input> = {
  name: "places_details",
  description:
    "Ficha completa del negocio en Google Places: nombre, dirección, web, teléfono, nota media, " +
    "número de reseñas, reseñas recientes, tipos y estado. Cachea 30 días y cuenta contra la cuota, " +
    "así que pídela una vez por prospecto.",
  inputSchema,

  async run(input): Promise<ToolResult> {
    const { placeId } = input;

    let payload: PlaceSummary & { reviews?: unknown[] };
    let cacheHit = true;

    try {
      const cached = await readCache(placeId);
      if (cached) {
        payload = cached;
      } else {
        cacheHit = false;
        payload = await placesFetch(`/places/${encodeURIComponent(placeId)}`, DETAILS_FIELDS);
        await writeCache(placeId, payload);
      }
    } catch (err) {
      if (err instanceof PlacesError) {
        return { ok: false, errorCode: err.code, message: err.message };
      }
      return { ok: false, errorCode: "PLACES_FAILED", message: errorMessage(err) };
    }

    const name = payload.displayName?.text ?? "(sin nombre)";
    const url = `https://www.google.com/maps/place/?q=place_id:${placeId}`;

    const quote = [
      `${name} — ${payload.formattedAddress ?? "(sin dirección)"}`,
      `web: ${payload.websiteUri ?? "(ninguna)"} · teléfono: ${payload.nationalPhoneNumber ?? "(ninguno)"}`,
      `valoración: ${payload.rating ?? "s/d"} sobre ${payload.userRatingCount ?? 0} reseñas`,
      `tipos: ${(payload.types ?? []).join(", ") || "(ninguno)"}`,
      `estado: ${payload.businessStatus ?? "s/d"}`,
    ].join("\n");

    return {
      ok: true,
      summary: `${name} · ${payload.rating ?? "s/d"}★ (${payload.userRatingCount ?? 0}) · ${
        cacheHit ? "de caché" : "de la API"
      }`,
      observations: [
        observe({
          tool: "places_details",
          url,
          quote,
          layer: "external_source",
          method: cacheHit
            ? "Google Places (New) v1 · caché de 30 días"
            : "Google Places (New) v1 · llamada directa",
          raw: { ...payload, cacheHit },
        }),
      ],
    };
  },
};
