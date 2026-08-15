/**
 * El planificador de zonas: lo que hace que "programada" signifique algo.
 *
 * Hasta ahora una zona podía guardar su expresión cron y la tabla la mostraba,
 * pero no la disparaba nadie. Esto cierra ese hueco.
 *
 * Vive dentro del worker y no como un proceso aparte a propósito. Un cron del
 * sistema tendría que saber la URL de la base, cargar el mismo `.env` y
 * duplicar la lógica de encolado; y si el worker está apagado, encolaría
 * trabajos que nadie va a atender. Aquí, si el worker no corre, sencillamente no
 * se programa nada — que es el comportamiento honesto.
 *
 * No hay estado propio de "última vez que disparé": el ancla es `lastScanAt` de
 * la zona, que ya existe y la escribe el propio escaneo. Una tabla nueva para
 * eso sería un segundo sitio donde la verdad puede desincronizarse.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, enqueue, scans, zones } from "@borsoga/db";
import { isDue, isValidSchedule } from "./schedule-rule";
import { errorMessage, log } from "./log";

/** Cada cuánto se mira si toca. Un minuto es la resolución de cron. */
export const TICK_MS = 60_000;

/** Una pasada. Devuelve cuántos escaneos encoló. */
export async function runSchedulerTick(now: Date = new Date()): Promise<number> {
  const candidates = await db
    .select({
      id: zones.id,
      name: zones.name,
      schedule: zones.schedule,
      lastScanAt: zones.lastScanAt,
      createdAt: zones.createdAt,
    })
    .from(zones)
    .where(and(eq(zones.active, true), isNotNull(zones.schedule)));

  if (candidates.length === 0) return 0;

  /*
   * Una zona con un escaneo en marcha no se vuelve a encolar aunque toque. Sin
   * esto, una zona horaria cuyo escaneo tarda más de una hora acumularía
   * trabajos hasta agotar la cuota de Places.
   */
  const busy = await db
    .select({ zoneId: scans.zoneId })
    .from(scans)
    .where(inArray(scans.status, ["queued", "running"]));

  const busyZones = new Set(busy.map((s) => s.zoneId));
  let queued = 0;

  for (const zone of candidates) {
    if (!zone.schedule) continue;
    if (busyZones.has(zone.id)) continue;

    if (!isValidSchedule(zone.schedule)) {
      log.warn("expresión cron inválida, zona saltada", {
        zona: zone.name,
        schedule: zone.schedule,
      });
      continue;
    }

    if (!isDue(zone.schedule, zone.lastScanAt, zone.createdAt, now)) continue;

    const [scan] = await db.insert(scans).values({ zoneId: zone.id }).returning({ id: scans.id });
    if (!scan) continue;

    await enqueue(
      db,
      "scan.zone",
      { scanId: scan.id, zoneId: zone.id },
      { scanId: scan.id, priority: 0 },
    );

    queued += 1;
    log.info("zona programada encolada", {
      zona: zone.name,
      schedule: zone.schedule,
      scanId: scan.id,
    });
  }

  return queued;
}

/** Arranca el bucle. Devuelve la función para pararlo. */
export function startScheduler(): () => void {
  const timer = setInterval(() => {
    void runSchedulerTick().catch((err) =>
      log.error("el planificador falló", { err: errorMessage(err) }),
    );
  }, TICK_MS);

  timer.unref();
  log.info("planificador en marcha", { tickMs: TICK_MS });

  return () => clearInterval(timer);
}
