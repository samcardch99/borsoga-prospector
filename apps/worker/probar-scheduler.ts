/** Prueba del planificador. Sin LLM y sin Places: el worker está apagado. */
import { eq } from "drizzle-orm";
import { db, jobs, pgClient, scans, zones } from "@borsoga/db";
import { isDue, runSchedulerTick } from "./src/scheduler";

function check(etiqueta: string, real: boolean, esperado: boolean): void {
  console.log(`${real === esperado ? "OK  " : "FALLA"} ${etiqueta} → ${real} (esperado ${esperado})`);
}

async function main(): Promise<void> {
  const creada = new Date("2026-01-01T00:00:00Z");

  console.log("── isDue ───────────────────────────────────");
  /* Ojo con la zona horaria: el cron va en hora de Florida (EDT = UTC-4 en
     agosto), así que un "lunes a las 3:00" es 07:00Z. */
  check(
    "semanal, recién escaneada",
    isDue("0 3 * * 1", new Date("2026-08-10T07:00:00Z"), creada, new Date("2026-08-10T13:00:00Z")),
    false,
  );
  check(
    "semanal, pasó una semana",
    isDue("0 3 * * 1", new Date("2026-08-10T07:00:00Z"), creada, new Date("2026-08-17T08:00:00Z")),
    true,
  );
  check(
    "semanal, el ancla cae en domingo noche",
    isDue("0 3 * * 1", new Date("2026-08-10T03:00:00Z"), creada, new Date("2026-08-10T13:00:00Z")),
    true,
  );
  check(
    "horaria, hace dos horas",
    isDue("0 * * * *", new Date("2026-08-15T10:00:00Z"), creada, new Date("2026-08-15T12:05:00Z")),
    true,
  );
  check(
    "horaria, hace diez minutos",
    isDue("0 * * * *", new Date("2026-08-15T12:00:00Z"), creada, new Date("2026-08-15T12:10:00Z")),
    false,
  );
  check(
    "nunca escaneada, ancla en la creación",
    isDue("0 3 * * *", null, creada, new Date("2026-01-02T05:00:00Z")),
    true,
  );
  check("expresión inválida", isDue("esto no es cron", null, creada, new Date()), false);

  console.log("\n── pasada real ─────────────────────────────");
  const antes = await runSchedulerTick();
  console.log(`con los datos actuales encoló: ${antes} (la zona está inactiva y sin cron)`);

  const [zona] = await db.select({ id: zones.id, name: zones.name }).from(zones).limit(1);
  if (!zona) throw new Error("sin zonas");

  // Activar y programar cada minuto para forzar que toque.
  await db.update(zones).set({ active: true, schedule: "* * * * *" }).where(eq(zones.id, zona.id));
  const encolados = await runSchedulerTick();
  console.log(`tras activar y programar "* * * * *": encoló ${encolados}`);

  const pendientes = await db
    .select({ id: jobs.id, kind: jobs.kind, status: jobs.status, scanId: jobs.scanId })
    .from(jobs)
    .where(eq(jobs.kind, "scan.zone"));
  console.log(`trabajos scan.zone en la cola: ${pendientes.length}`);

  // Segunda pasada: no debe duplicar, porque el escaneo quedó en `queued`.
  const segunda = await runSchedulerTick();
  console.log(`segunda pasada seguida: encoló ${segunda} (debe ser 0, ya hay uno en marcha)`);

  // Limpieza: borrar lo creado y dejar la zona como estaba.
  for (const j of pendientes) {
    await db.delete(jobs).where(eq(jobs.id, j.id));
    if (j.scanId) await db.delete(scans).where(eq(scans.id, j.scanId));
  }
  await db.update(zones).set({ active: false, schedule: null }).where(eq(zones.id, zona.id));

  const restantes = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.kind, "scan.zone"));
  console.log(`limpieza: quedan ${restantes.length} trabajos scan.zone y la zona vuelve a inactiva`);

  await pgClient.end({ timeout: 5 });
}

void main();
