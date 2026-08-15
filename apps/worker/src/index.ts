/**
 * Worker de Borsoga Prospector.
 *
 * Tira de la cola de Postgres, ejecuta el trabajo y escribe el resultado. La
 * plataforma Next.js nunca habla con el modelo: lee lo que este proceso deja
 * en la base. Si el worker está apagado, los trabajos esperan — que es
 * exactamente lo que muestran la vista de Traza y el estado de error.
 */

import { claimJobs, completeJob, db, failJob, pgClient, reapStaleJobs } from "@borsoga/db";
import type { ClaimedJob } from "@borsoga/db";
import { config } from "./config";
import { auditProspect, type AuditProspectPayload } from "./handlers/audit-prospect";
import { scanZone, type ScanZonePayload } from "./handlers/scan-zone";
import { errorMessage, log } from "./log";
import { closeBrowser } from "./tools";

const shutdown = new AbortController();
let inFlight = 0;

async function dispatch(job: ClaimedJob): Promise<void> {
  switch (job.kind) {
    case "scan.zone":
      return scanZone(job.payload as ScanZonePayload);
    case "audit.prospect":
      return auditProspect(job.payload as AuditProspectPayload, shutdown.signal);
    default:
      throw new Error(`tipo de trabajo no soportado: ${job.kind}`);
  }
}

async function run(job: ClaimedJob): Promise<void> {
  inFlight += 1;
  const t0 = performance.now();
  try {
    await dispatch(job);
    await completeJob(db, job.id);
    log.info("trabajo hecho", { kind: job.kind, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    const message = errorMessage(err);
    await failJob(db, job, message);
    log.error("trabajo fallido", { kind: job.kind, intento: job.attempts, err: message });
  } finally {
    inFlight -= 1;
  }
}

async function loop(): Promise<void> {
  const reaped = await reapStaleJobs(db);
  if (reaped > 0) log.warn("trabajos huérfanos devueltos a la cola", { reaped });

  // El worker local se apaga con la máquina: hay que recoger lo colgado cada
  // tanto, no solo al arrancar.
  const reaper = setInterval(() => {
    void reapStaleJobs(db).then((n) => {
      if (n > 0) log.warn("trabajos huérfanos devueltos a la cola", { reaped: n });
    });
  }, 5 * 60_000);
  reaper.unref();

  log.info("worker en marcha", {
    id: config.WORKER_ID,
    proveedor: config.LLM_PROVIDER,
    modelo: config.LLM_MODEL,
    concurrencia: config.WORKER_CONCURRENCY,
  });

  while (!shutdown.signal.aborted) {
    const free = config.WORKER_CONCURRENCY - inFlight;

    if (free <= 0) {
      await sleep(config.WORKER_POLL_MS);
      continue;
    }

    const jobs = await claimJobs(db, config.WORKER_ID, free);
    if (jobs.length === 0) {
      await sleep(config.WORKER_POLL_MS);
      continue;
    }

    for (const job of jobs) void run(job);
  }

  clearInterval(reaper);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stop(signal: string): Promise<void> {
  if (shutdown.signal.aborted) return;
  log.info("apagando", { signal, enCurso: inFlight });
  shutdown.abort();

  // Margen para que los trabajos en curso escriban su traza. Lo que no llegue
  // lo recoge reapStaleJobs cuando el worker vuelva.
  const deadline = Date.now() + 15_000;
  while (inFlight > 0 && Date.now() < deadline) await sleep(200);

  await closeBrowser();
  await pgClient.end({ timeout: 5 });
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

loop().catch(async (err) => {
  log.error("el worker murió", { err: errorMessage(err) });
  await closeBrowser();
  await pgClient.end({ timeout: 5 });
  process.exit(1);
});
