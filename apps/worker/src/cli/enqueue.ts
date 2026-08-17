/**
 * Utilidad de línea de comandos para meter trabajo en la cola sin interfaz.
 *
 * Existe porque la vista de Zonas todavía no está construida y hace falta poder
 * lanzar un escaneo (y, sobre todo, una sola auditoría) para ver la Traza
 * llenarse. Se borra el día que exista la pantalla.
 *
 *   pnpm --filter @borsoga/worker enqueue zone "Doral" miami_dade 25.809 -80.355 8000 kitchens,cabinetry
 *   pnpm --filter @borsoga/worker enqueue scan <zoneId>
 *   pnpm --filter @borsoga/worker enqueue prospect "Nombre" https://ejemplo.com Miami
 *   pnpm --filter @borsoga/worker enqueue status
 *   pnpm --filter @borsoga/worker enqueue steps
 */

import { desc, eq } from "drizzle-orm";
import { db, enqueue, jobs, pgClient, prospects, scans, traceSteps, zones } from "@borsoga/db";
import type { County, Sector } from "@borsoga/shared";

const [, , command, ...args] = process.argv;

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

async function createZone(): Promise<void> {
  const [name, county, lat, lng, radius, sectors] = args;
  if (!name || !county || !lat || !lng || !radius || !sectors) {
    die("uso: enqueue zone <nombre> <condado> <lat> <lng> <radioMetros> <sector,sector>");
  }

  const [zone] = await db
    .insert(zones)
    .values({
      name,
      county: county as County,
      centerLat: Number(lat),
      centerLng: Number(lng),
      radiusMeters: Number(radius),
      sectors: sectors.split(",").map((s) => s.trim()) as Sector[],
      schedule: null,
    })
    .returning({ id: zones.id });

  if (!zone) die("no se pudo crear la zona");
  console.log(`zona ${zone.id}`);
  await queueScan(zone.id);
}

async function queueScan(zoneId: string): Promise<void> {
  const [zone] = await db.select().from(zones).where(eq(zones.id, zoneId)).limit(1);
  if (!zone) die(`la zona ${zoneId} no existe`);

  const [scan] = await db.insert(scans).values({ zoneId }).returning({ id: scans.id });
  if (!scan) die("no se pudo crear el escaneo");

  const jobId = await enqueue(db, "scan.zone", { scanId: scan.id, zoneId }, { scanId: scan.id, priority: 10 });
  console.log(`escaneo ${scan.id} · trabajo ${jobId}`);
}

/**
 * Separa los prospectos de prueba sobre el mapa.
 *
 * Todos se creaban en el mismo punto del centro de Miami, así que dos
 * auditorías a la vez apilaban sus marcadores y la ventana en vivo parecía no
 * cambiar de sitio al conmutar entre una y otra. Derivarlo del nombre mantiene
 * la posición estable entre ejecuciones: el mismo nombre cae siempre igual.
 */
function scatter(name: string): { lat: number; lng: number } {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const a = ((h >>> 0) % 3600) / 3600;
  const b = ((h >>> 12) % 1000) / 1000;
  const radius = 0.012 * Math.sqrt(b); // ~1,3 km como mucho
  return {
    lat: 25.7617 + radius * Math.cos(a * 2 * Math.PI),
    lng: -80.1918 + radius * Math.sin(a * 2 * Math.PI),
  };
}

/**
 * Un prospecto suelto contra una zona de pruebas. Sirve para probar el bucle
 * del agente sin gastar cuota de Places: la ficha fallará y el agente seguirá
 * con la web, que es justo el comportamiento que interesa comprobar.
 */
async function createProspect(): Promise<void> {
  const [name, website, city] = args;
  if (!name) die('uso: enqueue prospect "<nombre>" [web] [ciudad]');
  const at = scatter(name);

  let [zone] = await db.select().from(zones).where(eq(zones.name, "Pruebas")).limit(1);
  if (!zone) {
    [zone] = await db
      .insert(zones)
      .values({
        name: "Pruebas",
        county: "miami_dade",
        centerLat: 25.7617,
        centerLng: -80.1918,
        radiusMeters: 1_000,
        sectors: [],
        schedule: null,
        active: false,
      })
      .returning();
  }
  if (!zone) die("no se pudo crear la zona de pruebas");

  const [scan] = await db
    .insert(scans)
    .values({ zoneId: zone.id, status: "running", progressTotal: 1, progressFound: 1 })
    .returning({ id: scans.id });
  if (!scan) die("no se pudo crear el escaneo");

  const [prospect] = await db
    .insert(prospects)
    .values({
      placeId: `manual:${name.toLowerCase().replace(/\s+/g, "-")}`,
      name,
      sectors: [],
      county: "miami_dade",
      city: city ?? "Miami",
      address: city ?? "Miami, FL",
      lat: at.lat,
      lng: at.lng,
      website: website ?? null,
      zoneId: zone.id,
    })
    .onConflictDoUpdate({
      target: prospects.placeId,
      set: { name, website: website ?? null, lat: at.lat, lng: at.lng },
    })
    .returning({ id: prospects.id });

  if (!prospect) die("no se pudo crear el prospecto");

  const jobId = await enqueue(
    db,
    "audit.prospect",
    { scanId: scan.id, prospectId: prospect.id },
    { scanId: scan.id, prospectId: prospect.id, priority: 10 },
  );
  console.log(`prospecto ${prospect.id} · escaneo ${scan.id} · trabajo ${jobId}`);
}

/**
 * Los últimos trabajos con su estado. Sin esto la única forma de saber si el
 * worker está haciendo algo es abrir la base a mano, y eso es justo lo que la
 * aplicación pretende quitarle a nadie de encima.
 */
async function showStatus(): Promise<void> {
  const rows = await db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      attempts: jobs.attempts,
      lockedAt: jobs.lockedAt,
      lastError: jobs.lastError,
      prospectName: prospects.name,
    })
    .from(jobs)
    .leftJoin(prospects, eq(prospects.id, jobs.prospectId))
    .orderBy(desc(jobs.createdAt))
    .limit(Number(args[0] ?? 10));

  if (rows.length === 0) {
    console.log("la cola está vacía");
    return;
  }

  for (const r of rows) {
    const label = r.prospectName ? ` · ${r.prospectName}` : "";
    const error = r.lastError ? ` · ${r.lastError.slice(0, 60)}` : "";
    console.log(
      `${r.status.padEnd(9)} ${r.kind.padEnd(15)} intento ${r.attempts}${label}${error}`,
    );
  }
}

/**
 * Los últimos pasos de traza, con lo que devolvió cada herramienta.
 *
 * La Traza de la interfaz enseña lo mismo, pero cuando lo que falla es la
 * propia interfaz hace falta poder mirar la fila sin ella.
 */
async function showSteps(): Promise<void> {
  const rows = await db
    .select({
      step: traceSteps.step,
      target: traceSteps.target,
      status: traceSteps.status,
      durationMs: traceSteps.durationMs,
      output: traceSteps.output,
    })
    .from(traceSteps)
    .orderBy(desc(traceSteps.startedAt))
    .limit(Number(args[0] ?? 15));

  for (const r of rows.reverse()) {
    const out = r.output as { errorCode?: string; observations?: unknown } | null;
    const detail = out?.errorCode
      ? ` · ${out.errorCode}`
      : Array.isArray(out?.observations)
        ? ` · ${out.observations.length} obs`
        : "";
    console.log(
      `${r.status.padEnd(8)} ${r.step.padEnd(18)} ${String(r.durationMs).padStart(6)}ms  ${r.target.slice(0, 48)}${detail}`,
    );
  }
}

try {
  switch (command) {
    case "zone":
      await createZone();
      break;
    case "scan":
      await queueScan(args[0] ?? die("uso: enqueue scan <zoneId>"));
      break;
    case "prospect":
      await createProspect();
      break;
    case "status":
      await showStatus();
      break;
    case "steps":
      await showSteps();
      break;
    default:
      die("comandos: zone · scan · prospect · status · steps");
  }
} finally {
  await pgClient.end({ timeout: 5 });
}
