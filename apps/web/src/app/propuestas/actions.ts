"use server";

/**
 * Escrituras del generador de propuestas.
 *
 * Todo lo que se toca aquí es de configuración —qué fases entran, qué descuento
 * se aplica— y nunca el contenido de un hallazgo. Los hallazgos y los precios
 * que salen de ellos son lo único que no se puede reescribir a mano en toda la
 * herramienta: son la parte que hay que poder defender con la evidencia
 * delante.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, enqueue, proposalBlocks, proposalPhases, proposals } from "@borsoga/db";

async function recomputeTotals(proposalId: string): Promise<void> {
  const phases = await db
    .select({ priceUsd: proposalPhases.priceUsd, enabled: proposalPhases.enabled })
    .from(proposalPhases)
    .where(eq(proposalPhases.proposalId, proposalId));

  const [proposal] = await db
    .select({ discountUsd: proposals.discountUsd })
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);

  const subtotal = phases.filter((p) => p.enabled).reduce((sum, p) => sum + p.priceUsd, 0);
  const discount = Math.min(proposal?.discountUsd ?? 0, subtotal);

  await db
    .update(proposals)
    .set({
      subtotalUsd: subtotal,
      discountUsd: discount,
      totalUsd: subtotal - discount,
      updatedAt: new Date(),
    })
    .where(eq(proposals.id, proposalId));
}

export async function togglePhase(
  proposalId: string,
  phaseId: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  await db
    .update(proposalPhases)
    .set({ enabled })
    // El `proposalId` en el WHERE no es decorativo: sin él, un id de fase de
    // otra propuesta bastaría para modificarla desde aquí.
    .where(and(eq(proposalPhases.id, phaseId), eq(proposalPhases.proposalId, proposalId)));

  await recomputeTotals(proposalId);
  revalidatePath("/propuestas");
  return { ok: true };
}

// ─── Bloques del documento ───────────────────────────────────────────────────

/** Reordena los bloques por su lista de ids. Es lo que deja el arrastre. */
export async function reorderBlocks(
  proposalId: string,
  orderedIds: string[],
): Promise<{ ok: boolean }> {
  await Promise.all(
    orderedIds.map((id, index) =>
      db
        .update(proposalBlocks)
        .set({ order: index })
        .where(and(eq(proposalBlocks.id, id), eq(proposalBlocks.proposalId, proposalId))),
    ),
  );

  revalidatePath("/propuestas");
  return { ok: true };
}

export async function toggleBlock(
  proposalId: string,
  blockId: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  await db
    .update(proposalBlocks)
    .set({ enabled })
    .where(and(eq(proposalBlocks.id, blockId), eq(proposalBlocks.proposalId, proposalId)));

  revalidatePath("/propuestas");
  return { ok: true };
}

export async function updateBlockContent(
  proposalId: string,
  blockId: string,
  content: string,
): Promise<{ ok: boolean }> {
  await db
    .update(proposalBlocks)
    .set({ content })
    .where(and(eq(proposalBlocks.id, blockId), eq(proposalBlocks.proposalId, proposalId)));

  revalidatePath("/propuestas");
  return { ok: true };
}

/**
 * Añade un bloque al final. Solo tipos que el documento sabe pintar, y nunca
 * `findings` ni `pricing` duplicados: esos dos salen de la base y tener dos
 * copias del mismo listado en un documento no significa nada.
 */
export async function addBlock(
  proposalId: string,
  type: "text" | "ai_text",
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: "El bloque necesita un nombre." };

  const existing = await db
    .select({ order: proposalBlocks.order })
    .from(proposalBlocks)
    .where(eq(proposalBlocks.proposalId, proposalId));

  const next = existing.reduce((max, b) => Math.max(max, b.order), -1) + 1;

  await db.insert(proposalBlocks).values({
    proposalId,
    type,
    name: trimmed,
    enabled: true,
    order: next,
    content: "",
  });

  revalidatePath("/propuestas");
  return { ok: true };
}

export async function deleteBlock(
  proposalId: string,
  blockId: string,
): Promise<{ ok: boolean; error?: string }> {
  const [block] = await db
    .select({ type: proposalBlocks.type })
    .from(proposalBlocks)
    .where(and(eq(proposalBlocks.id, blockId), eq(proposalBlocks.proposalId, proposalId)))
    .limit(1);

  if (!block) return { ok: false, error: "Ese bloque ya no existe." };
  if (block.type === "fixed") {
    return { ok: false, error: "Los bloques fijos no se borran; desactívalos si estorban." };
  }

  await db
    .delete(proposalBlocks)
    .where(and(eq(proposalBlocks.id, blockId), eq(proposalBlocks.proposalId, proposalId)));

  revalidatePath("/propuestas");
  return { ok: true };
}

const TONES = ["direct", "close", "technical"] as const;

export async function setTone(
  proposalId: string,
  tone: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(TONES as readonly string[]).includes(tone)) return { ok: false, error: "Tono desconocido." };

  await db
    .update(proposals)
    .set({ tone, updatedAt: new Date() })
    .where(eq(proposals.id, proposalId));

  revalidatePath("/propuestas");
  return { ok: true };
}

/**
 * Encola una reescritura. Como en la reverificación, la web no llama al modelo:
 * deja el trabajo en la cola y el worker lo recoge.
 *
 * Solo se le pasan los bloques `ai_text`. Es la regla que el handoff §6.4 pone
 * por escrito y la que hace que la propuesta siga siendo defendible: los
 * hallazgos y los precios nunca pasan por el modelo.
 */
export async function requestRewrite(
  proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const blocks = await db
    .select({ id: proposalBlocks.id })
    .from(proposalBlocks)
    .where(and(eq(proposalBlocks.proposalId, proposalId), eq(proposalBlocks.type, "ai_text")));

  if (blocks.length === 0) {
    return { ok: false, error: "No hay ningún bloque de texto IA que reescribir." };
  }

  const [proposal] = await db
    .select({ prospectId: proposals.prospectId })
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);

  if (!proposal) return { ok: false, error: "Esa propuesta ya no existe." };

  await enqueue(
    db,
    "proposal.draft",
    { proposalId, blockIds: blocks.map((b) => b.id) },
    { priority: 10, prospectId: proposal.prospectId },
  );

  revalidatePath("/propuestas");
  return { ok: true };
}

export async function setDiscount(
  proposalId: string,
  discountUsd: number,
): Promise<{ ok: boolean }> {
  const safe = Number.isFinite(discountUsd) ? Math.max(0, Math.round(discountUsd)) : 0;

  await db
    .update(proposals)
    .set({ discountUsd: safe, updatedAt: new Date() })
    .where(eq(proposals.id, proposalId));

  await recomputeTotals(proposalId);
  revalidatePath("/propuestas");
  return { ok: true };
}
