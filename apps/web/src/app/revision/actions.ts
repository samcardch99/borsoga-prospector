"use server";

/**
 * Las escrituras de la cola de revisión. Es lo primero de la plataforma que
 * cambia datos: hasta aquí todo era lectura de lo que dejó el worker.
 *
 * La web sigue sin hablar con el modelo. "Reverificar" no llama a nadie: encola
 * un trabajo y devuelve el hallazgo a `pending`. Si el worker está apagado, el
 * trabajo espera — que es exactamente lo que la interfaz debe mostrar.
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, enqueue, findings as findingsTable, recomputeProspectScore } from "@borsoga/db";
import type { Verdict } from "@borsoga/shared";

/**
 * El recálculo vive en `@borsoga/db` porque la web no es la única que cambia
 * hallazgos: el worker también, cuando una reverificación mueve una severidad.
 * Tener aquí una copia propia fue precisamente el fallo que apareció al
 * ejecutar el worker por primera vez.
 */
function refresh(prospectId: string): void {
  revalidatePath("/revision");
  revalidatePath("/");
  revalidatePath(`/expediente/${prospectId}`);
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Confirmar, matizar o descartar. Solo el humano llega aquí: la IA propone
 * `pending` y nada más (handoff §5).
 */
export async function setVerdict(
  findingId: string,
  verdict: Exclude<Verdict, "pending">,
  note?: string,
): Promise<ActionResult> {
  /*
   * La nota es obligatoria al matizar y lo dice el propio esquema. Matizar sin
   * explicar qué se matiza deja un hallazgo que nadie sabe cómo defender, que
   * es peor que descartarlo.
   */
  const trimmed = note?.trim() ?? "";
  if (verdict === "nuanced" && trimmed.length === 0) {
    return { ok: false, error: "Matizar exige una nota que explique el matiz." };
  }

  const [row] = await db
    .update(findingsTable)
    .set({
      verdict,
      reviewedAt: new Date(),
      // `reviewedBy` se queda null: todavía no hay sesiones ni usuarios. Cuando
      // los haya, es este el sitio donde se rellena.
      reviewNote: verdict === "nuanced" ? trimmed : null,
    })
    .where(eq(findingsTable.id, findingId))
    .returning({ prospectId: findingsTable.prospectId });

  if (!row) return { ok: false, error: "Ese hallazgo ya no existe." };

  await recomputeProspectScore(db, row.prospectId);
  refresh(row.prospectId);
  return { ok: true };
}

/**
 * Devuelve el hallazgo a `pending` y encola un `finding.recheck`.
 *
 * Prioridad 10: quien pide una reverificación está esperando delante de la
 * pantalla, así que va por delante de los escaneos de fondo.
 */
export async function requestRecheck(findingId: string): Promise<ActionResult> {
  const [row] = await db
    .select({
      id: findingsTable.id,
      prospectId: findingsTable.prospectId,
      recheckCount: findingsTable.recheckCount,
    })
    .from(findingsTable)
    .where(eq(findingsTable.id, findingId))
    .limit(1);

  if (!row) return { ok: false, error: "Ese hallazgo ya no existe." };

  await db
    .update(findingsTable)
    .set({
      verdict: "pending",
      reviewedAt: null,
      reviewNote: null,
      recheckCount: row.recheckCount + 1,
    })
    .where(eq(findingsTable.id, findingId));

  await enqueue(
    db,
    "finding.recheck",
    { findingId, prospectId: row.prospectId },
    { priority: 10, prospectId: row.prospectId },
  );

  await recomputeProspectScore(db, row.prospectId);
  refresh(row.prospectId);
  return { ok: true };
}
