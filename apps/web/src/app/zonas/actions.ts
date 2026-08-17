"use server";

/**
 * Zonas: crear, activar y lanzar escaneos.
 *
 * "Escanear" no llama a Places ni al modelo desde aquí. Crea la fila de `scans`
 * y encola un `scan.zone`, igual que hace el CLI del worker. Si el worker está
 * apagado el trabajo espera, y eso es exactamente lo que la interfaz debe
 * reflejar (handoff §10.2).
 */

import { revalidatePath } from "next/cache";
import { eq, not } from "drizzle-orm";
import { db, enqueue, scans, zones } from "@borsoga/db";
import { zoneInputSchema } from "@borsoga/shared";

export interface ZoneActionResult {
  ok: boolean;
  error?: string;
  scanId?: string;
}

function refresh(): void {
  revalidatePath("/zonas");
  revalidatePath("/");
}

/**
 * Crea una zona a partir del formulario. La validación es la del contrato
 * (`zoneInputSchema`), no una copia: si el esquema cambia, esto cambia con él.
 */
export async function createZone(input: unknown): Promise<ZoneActionResult> {
  const parsed = zoneInputSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first ? `${first.path.join(".")}: ${first.message}` : "Datos inválidos." };
  }

  const z = parsed.data;

  await db.insert(zones).values({
    name: z.name,
    county: z.county,
    centerLat: z.center.lat,
    centerLng: z.center.lng,
    radiusMeters: z.radiusMeters,
    sectors: z.sectors,
    minTicketUsd: z.minTicketUsd,
    schedule: z.schedule ?? null,
    active: true,
  });

  refresh();
  return { ok: true };
}

export async function toggleZone(zoneId: string): Promise<ZoneActionResult> {
  await db
    .update(zones)
    .set({ active: not(zones.active) })
    .where(eq(zones.id, zoneId));

  refresh();
  return { ok: true };
}

/**
 * Lanza un escaneo de la zona. Prioridad 10, igual que el CLI: alguien lo ha
 * pedido a mano y está esperando.
 */
export async function scanZoneNow(zoneId: string): Promise<ZoneActionResult> {
  const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.id, zoneId)).limit(1);
  if (!zone) return { ok: false, error: "Esa zona ya no existe." };

  const [scan] = await db.insert(scans).values({ zoneId }).returning({ id: scans.id });
  if (!scan) return { ok: false, error: "No se pudo crear el escaneo." };

  await enqueue(db, "scan.zone", { scanId: scan.id, zoneId }, { scanId: scan.id, priority: 10 });

  refresh();
  return { ok: true, scanId: scan.id };
}
