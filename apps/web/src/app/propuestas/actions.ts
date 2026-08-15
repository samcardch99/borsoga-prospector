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
import { db, proposalPhases, proposals } from "@borsoga/db";

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
