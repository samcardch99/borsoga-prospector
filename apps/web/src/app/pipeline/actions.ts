"use server";

/**
 * Movimientos del pipeline y descarte manual de prospectos.
 *
 * Nada de esto toca hallazgos ni evidencia: son decisiones comerciales sobre el
 * prospecto, no sobre lo que se vio en su sitio. Esa separación es la que
 * permite que un prospecto se pierda por precio sin que eso borre el
 * diagnóstico que se hizo de él.
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, prospects as prospectsTable } from "@borsoga/db";
import type { PipelineStage } from "@/lib/queries";

const STAGES: readonly PipelineStage[] = [
  "detected",
  "reviewed",
  "proposal_sent",
  "meeting",
  "won",
  "lost",
];

export async function moveToStage(
  prospectId: string,
  stage: PipelineStage,
): Promise<{ ok: boolean; error?: string }> {
  if (!STAGES.includes(stage)) return { ok: false, error: "Etapa desconocida." };

  await db
    .update(prospectsTable)
    .set({ stage, lastActivityAt: new Date() })
    .where(eq(prospectsTable.id, prospectId));

  revalidatePath("/pipeline");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Descartar a mano. No borra: `disqualified` más motivo legible, que es lo que
 * pide el handoff §5 — el equipo necesita ver por qué se descartó algo para
 * poder corregir los filtros.
 */
export async function discardProspect(
  prospectId: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Escribe el motivo: un descarte sin motivo no enseña nada." };
  }

  await db
    .update(prospectsTable)
    .set({
      disqualified: true,
      disqualifyReason: "manual",
      disqualifyNote: trimmed,
      stage: "lost",
      lastActivityAt: new Date(),
    })
    .where(eq(prospectsTable.id, prospectId));

  revalidatePath("/pipeline");
  revalidatePath("/");
  revalidatePath(`/expediente/${prospectId}`);
  return { ok: true };
}

/** Volver a meter en juego algo descartado a mano. */
export async function restoreProspect(prospectId: string): Promise<{ ok: boolean }> {
  await db
    .update(prospectsTable)
    .set({
      disqualified: false,
      disqualifyReason: null,
      disqualifyNote: null,
      stage: "detected",
      lastActivityAt: new Date(),
    })
    .where(eq(prospectsTable.id, prospectId));

  revalidatePath("/pipeline");
  revalidatePath("/");
  return { ok: true };
}
