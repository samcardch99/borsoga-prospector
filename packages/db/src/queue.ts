/**
 * Cola de trabajos sobre Postgres con FOR UPDATE SKIP LOCKED.
 *
 * Por qué esto y no Redis: el handoff pide que si el worker está apagado la
 * plataforma siga mostrando lo ya escaneado y los trabajos esperen. Una tabla
 * hace eso con cero infraestructura, y el bucle agéntico lo necesita más que un
 * pipeline determinista — un run puede tardar minutos y morir a la mitad.
 */

import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import { jobs } from "./schema";

export type JobKind =
  | "scan.zone"
  | "audit.prospect"
  | "finding.recheck"
  | "proposal.draft";

export interface ClaimedJob extends Record<string, unknown> {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  scanId: string | null;
  prospectId: string | null;
}

/**
 * Reclama hasta `limit` trabajos. SKIP LOCKED deja que varios workers tiren de
 * la misma cola sin bloquearse entre ellos.
 */
export async function claimJobs(
  db: Db,
  workerId: string,
  limit = 1,
): Promise<ClaimedJob[]> {
  const rows = await db.execute<ClaimedJob>(sql`
    UPDATE ${jobs}
    SET status = 'running',
        locked_by = ${workerId},
        locked_at = now(),
        attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM ${jobs}
      WHERE status = 'queued' AND run_after <= now()
      ORDER BY priority DESC, run_after ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, attempts, max_attempts AS "maxAttempts",
              scan_id AS "scanId", prospect_id AS "prospectId"
  `);

  return rows as unknown as ClaimedJob[];
}

export async function enqueue(
  db: Db,
  kind: JobKind,
  payload: unknown,
  opts: {
    priority?: number;
    runAfter?: Date;
    scanId?: string | null;
    prospectId?: string | null;
    maxAttempts?: number;
  } = {},
): Promise<string> {
  const [row] = await db
    .insert(jobs)
    .values({
      kind,
      payload: payload as never,
      priority: opts.priority ?? 0,
      runAfter: opts.runAfter ?? new Date(),
      scanId: opts.scanId ?? null,
      prospectId: opts.prospectId ?? null,
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .returning({ id: jobs.id });

  if (!row) throw new Error("no se pudo encolar el trabajo");
  return row.id;
}

export async function completeJob(db: Db, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "done", finishedAt: new Date(), lockedBy: null, lockedAt: null })
    .where(eq(jobs.id, jobId));
}

/** Retroceso exponencial con techo de 15 min. */
export function backoffMs(attempts: number): number {
  return Math.min(15 * 60_000, 2 ** attempts * 1_000);
}

export async function failJob(
  db: Db,
  job: Pick<ClaimedJob, "id" | "attempts" | "maxAttempts">,
  error: string,
): Promise<void> {
  const exhausted = job.attempts >= job.maxAttempts;

  await db
    .update(jobs)
    .set({
      status: exhausted ? "failed" : "queued",
      lastError: error.slice(0, 2000),
      lockedBy: null,
      lockedAt: null,
      ...(exhausted
        ? { finishedAt: new Date() }
        : { runAfter: new Date(Date.now() + backoffMs(job.attempts)) }),
    })
    .where(eq(jobs.id, job.id));
}

/**
 * Devuelve a la cola los trabajos que un worker dejó colgados al morir.
 * Llamar al arrancar y periódicamente: el worker local se apaga con la máquina.
 */
export async function reapStaleJobs(db: Db, staleAfterMs = 20 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);

  const reaped = await db
    .update(jobs)
    .set({ status: "queued", lockedBy: null, lockedAt: null })
    .where(and(eq(jobs.status, "running"), lte(jobs.lockedAt, cutoff)))
    .returning({ id: jobs.id });

  return reaped.length;
}
