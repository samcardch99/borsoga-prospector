/**
 * `proposal.draft`: redactar los bloques de texto IA de una propuesta.
 *
 * El último de los cuatro tipos de trabajo que la cola contempla.
 *
 * Este handler es deliberadamente el más corto de los tres, y sin herramientas.
 * No investiga nada: los hechos ya están en la base —los hallazgos, sus citas,
 * los precios— y lo único que se le pide al modelo es ponerlos en prosa con un
 * tono. Darle herramientas aquí sería invitarle a salir a buscar cosas que
 * luego aparecerían en un documento que se manda a un cliente sin que nadie las
 * haya verificado.
 *
 * Y solo escribe en bloques `ai_text`. Los hallazgos y los precios se le pasan
 * como material de lectura, nunca como algo que pueda reescribir.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  evidence as evidenceTable,
  findings as findingsTable,
  proposalBlocks,
  proposalPhases,
  proposals,
  prospects,
} from "@borsoga/db";
import {
  proposalDraftOutputJsonSchema,
  proposalDraftOutputSchema,
  type AgentToolContext,
} from "@borsoga/shared";
import { config } from "../config";
import { log } from "../log";
import { waitTurn } from "../net/politeness";
import { draftPrompt, draftSystem } from "../prompts";
import { getProvider } from "../providers";

export interface DraftProposalPayload {
  proposalId: string;
  blockIds: string[];
}

export async function draftProposal(
  payload: DraftProposalPayload,
  signal: AbortSignal,
): Promise<void> {
  const { proposalId, blockIds } = payload;

  const [row] = await db
    .select({ proposal: proposals, prospect: prospects })
    .from(proposals)
    .innerJoin(prospects, eq(proposals.prospectId, prospects.id))
    .where(eq(proposals.id, proposalId))
    .limit(1);

  if (!row) throw new Error(`propuesta ${proposalId} no existe`);
  const { proposal, prospect } = row;

  /* Solo los bloques pedidos Y de tipo ai_text. El filtro se repite aquí a
     propósito: el payload viene de la web y no es la autoridad sobre qué se
     puede reescribir. */
  const blocks = await db
    .select({ id: proposalBlocks.id, name: proposalBlocks.name })
    .from(proposalBlocks)
    .where(
      and(
        eq(proposalBlocks.proposalId, proposalId),
        eq(proposalBlocks.type, "ai_text"),
        inArray(proposalBlocks.id, blockIds),
      ),
    );

  if (blocks.length === 0) {
    log.warn("nada que redactar", { proposalId });
    return;
  }

  const found = await db
    .select({
      title: findingsTable.title,
      clientGain: findingsTable.clientGain,
      severity: findingsTable.severity,
      url: evidenceTable.url,
    })
    .from(findingsTable)
    .innerJoin(evidenceTable, eq(findingsTable.evidenceId, evidenceTable.id))
    .where(
      and(
        eq(findingsTable.prospectId, prospect.id),
        eq(findingsTable.excludedFromProposal, false),
      ),
    )
    .orderBy(findingsTable.severity);

  const phases = await db
    .select({ name: proposalPhases.name, priceUsd: proposalPhases.priceUsd })
    .from(proposalPhases)
    .where(and(eq(proposalPhases.proposalId, proposalId), eq(proposalPhases.enabled, true)));

  const ctx: AgentToolContext = {
    scanId: proposalId,
    prospectId: prospect.id,
    signal,
    rateLimit: waitTurn,
  };

  const run = await getProvider().runAgent({
    system: draftSystem,
    prompt: draftPrompt({
      prospectName: prospect.name,
      city: prospect.city,
      tone: proposal.tone,
      language: proposal.language,
      blocks,
      findings: found,
      phases,
    }),
    // Sin herramientas: ver la nota de arriba.
    tools: [],
    ctx,
    schemaName: "ProposalDraftOutput",
    schema: proposalDraftOutputJsonSchema,
    maxTurns: config.LLM_MAX_TURNS,
    maxCostUsd: config.LLM_MAX_COST_USD_PER_PROSPECT,
  });

  if (run.stopReason !== "completed" || run.json === null) {
    throw new Error(`el agente no entregó redacción (${run.stopReason})`);
  }

  const parsed = proposalDraftOutputSchema.safeParse(run.json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`redacción inválida: ${issues.join("; ")}`);
  }

  const allowed = new Set(blocks.map((b) => b.id));
  let written = 0;

  for (const block of parsed.data.blocks) {
    // Un id que no estaba en la lista se ignora en silencio: el modelo no
    // decide qué bloques de la propuesta se tocan.
    if (!allowed.has(block.id)) continue;

    await db
      .update(proposalBlocks)
      .set({ content: block.content })
      .where(eq(proposalBlocks.id, block.id));

    written += 1;
  }

  await db
    .update(proposals)
    .set({ updatedAt: new Date(), version: proposal.version + 1 })
    .where(eq(proposals.id, proposalId));

  log.info("propuesta redactada", { proposalId, bloques: written, tono: proposal.tone });
}
