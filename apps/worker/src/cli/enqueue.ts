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
 */

import { eq } from "drizzle-orm";
import { db, enqueue, pgClient, prospects, scans, zones } from "@borsoga/db";
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
 * Un prospecto suelto contra una zona de pruebas. Sirve para probar el bucle
 * del agente sin gastar cuota de Places: la ficha fallará y el agente seguirá
 * con la web, que es justo el comportamiento que interesa comprobar.
 */
async function createProspect(): Promise<void> {
  const [name, website, city] = args;
  if (!name) die('uso: enqueue prospect "<nombre>" [web] [ciudad]');

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
      lat: 25.7617,
      lng: -80.1918,
      website: website ?? null,
      zoneId: zone.id,
    })
    .onConflictDoUpdate({
      target: prospects.placeId,
      set: { name, website: website ?? null },
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
    default:
      die("comandos: zone · scan · prospect");
  }
} finally {
  await pgClient.end({ timeout: 5 });
}
