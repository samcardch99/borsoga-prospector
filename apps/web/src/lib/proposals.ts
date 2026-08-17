/**
 * Carga (o crea) el borrador de propuesta de un prospecto.
 *
 * Crear al entrar y no con un botón es deliberado: la propuesta nace del
 * expediente, y todo lo que hay en ella —las fases, los precios, los hallazgos
 * que cita— sale de datos que ya existen. Pedir un clic para generar algo que
 * está completamente determinado por el expediente solo añade un paso.
 *
 * Lo que sí se respeta es que un borrador ya tocado no se pisa: si hay uno en
 * `draft`, se devuelve tal cual, con las fases que alguien haya activado o
 * desactivado.
 */

import { and, asc, eq } from "drizzle-orm";
import {
  db,
  evidence as evidenceTable,
  findings as findingsTable,
  proposalBlocks,
  proposalPhases,
  proposals,
  prospects as prospectsTable,
} from "@borsoga/db";
import {
  BRANCHES,
  PHASE_TEMPLATE,
  branchTicket,
  type Branch,
  type Severity,
  type Verdict,
} from "@borsoga/shared";

export interface ProposalPhase {
  id: string;
  branch: Branch;
  name: string;
  deliverables: string[];
  priceUsd: number;
  weeks: string;
  enabled: boolean;
  order: number;
  findingIds: string[];
}

export interface ProposalFinding {
  id: string;
  branch: Branch;
  severity: Severity;
  verdict: Verdict;
  title: string;
  clientGain: string;
  evidenceUrl: string;
  capturedAt: Date;
}

export type BlockType = "fixed" | "text" | "ai_text" | "findings" | "pricing";

export interface ProposalBlock {
  id: string;
  type: BlockType;
  name: string;
  enabled: boolean;
  order: number;
  content: string | null;
}

/**
 * Los bloques por defecto del documento.
 *
 * El reparto de tipos no es decorativo: marca qué puede reescribir la IA y qué
 * no. Solo los `ai_text` se le pasan al modelo. Los `findings` y el `pricing`
 * salen de la base y no se tocan nunca — son la parte que hay que poder
 * defender con la evidencia delante, y un modelo reescribiéndolos convertiría
 * la propuesta en literatura.
 */
const DEFAULT_BLOCKS: Array<Omit<ProposalBlock, "id">> = [
  { type: "fixed", name: "Membrete", enabled: true, order: 0, content: null },
  { type: "fixed", name: "Título y fecha", enabled: true, order: 1, content: null },
  {
    type: "ai_text",
    name: "Párrafo de apertura",
    enabled: true,
    order: 2,
    content: null,
  },
  { type: "findings", name: "Lo más urgente", enabled: true, order: 3, content: null },
  { type: "pricing", name: "Cómo lo resolvemos", enabled: true, order: 4, content: null },
  {
    type: "ai_text",
    name: "El siguiente paso",
    enabled: true,
    order: 5,
    content: null,
  },
];

export interface LoadedProposal {
  id: string;
  prospectId: string;
  prospectName: string;
  prospectCity: string;
  status: string;
  language: string;
  tone: string;
  recipientName: string;
  discountUsd: number;
  createdAt: Date;
  phases: ProposalPhase[];
  blocks: ProposalBlock[];
  /** Los hallazgos que la propuesta puede citar, ya ordenados por gravedad. */
  findings: ProposalFinding[];
}

/** Subtotal, descuento y total. Una sola función para que no diverjan. */
export function proposalTotals(
  phases: ProposalPhase[],
  discountUsd: number,
): { subtotal: number; discount: number; total: number } {
  const subtotal = phases.filter((p) => p.enabled).reduce((sum, p) => sum + p.priceUsd, 0);
  const discount = Math.min(discountUsd, subtotal);
  return { subtotal, discount, total: subtotal - discount };
}

export async function loadOrCreateProposal(prospectId: string): Promise<LoadedProposal | null> {
  const [prospect] = await db
    .select({
      id: prospectsTable.id,
      name: prospectsTable.name,
      city: prospectsTable.city,
      branchScores: prospectsTable.branchScores,
    })
    .from(prospectsTable)
    .where(eq(prospectsTable.id, prospectId))
    .limit(1);

  if (!prospect) return null;

  /*
   * Los hallazgos descartados no entran, y los excluidos a mano tampoco. Lo que
   * el auditor se desdijo en una reverificación queda fuera por
   * `excludedFromProposal`, no por su veredicto — sigue pendiente de que alguien
   * lo mire, pero no se le enseña a un cliente.
   */
  const findings = await db
    .select({
      id: findingsTable.id,
      branch: findingsTable.branch,
      severity: findingsTable.severity,
      verdict: findingsTable.verdict,
      title: findingsTable.title,
      clientGain: findingsTable.clientGain,
      evidenceUrl: evidenceTable.url,
      capturedAt: evidenceTable.capturedAt,
    })
    .from(findingsTable)
    .innerJoin(evidenceTable, eq(findingsTable.evidenceId, evidenceTable.id))
    .where(
      and(
        eq(findingsTable.prospectId, prospectId),
        eq(findingsTable.excludedFromProposal, false),
      ),
    )
    .orderBy(findingsTable.severity, findingsTable.detectedAt);

  const usable = findings.filter((f) => f.verdict !== "discarded");

  const [existing] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.prospectId, prospectId), eq(proposals.status, "draft")))
    .limit(1);

  const proposal =
    existing ??
    (
      await db
        .insert(proposals)
        .values({ prospectId, status: "draft", recipientName: "" })
        .returning()
    )[0];

  if (!proposal) throw new Error("no se pudo crear el borrador de propuesta");

  let phases = await db
    .select()
    .from(proposalPhases)
    .where(eq(proposalPhases.proposalId, proposal.id))
    .orderBy(asc(proposalPhases.order));

  if (phases.length === 0) {
    const scores = (prospect.branchScores ?? {}) as Partial<Record<Branch, number>>;

    const seeds = BRANCHES.map((branch, index) => ({ branch, index }))
      .filter(({ branch }) => usable.some((f) => f.branch === branch))
      .map(({ branch, index }) => ({
        proposalId: proposal.id,
        branch,
        name: PHASE_TEMPLATE[branch].name,
        deliverables: PHASE_TEMPLATE[branch].deliverables,
        priceUsd: branchTicket(branch, scores[branch] ?? 0),
        weeks: PHASE_TEMPLATE[branch].weeks,
        enabled: true,
        order: index,
        findingIds: usable.filter((f) => f.branch === branch).map((f) => f.id),
      }));

    if (seeds.length > 0) {
      phases = await db.insert(proposalPhases).values(seeds).returning();
    }
  }

  let blocks = await db
    .select()
    .from(proposalBlocks)
    .where(eq(proposalBlocks.proposalId, proposal.id))
    .orderBy(asc(proposalBlocks.order));

  if (blocks.length === 0) {
    blocks = await db
      .insert(proposalBlocks)
      .values(DEFAULT_BLOCKS.map((b) => ({ ...b, proposalId: proposal.id })))
      .returning();
  }

  return {
    id: proposal.id,
    prospectId,
    prospectName: prospect.name,
    prospectCity: prospect.city,
    status: proposal.status,
    language: proposal.language,
    tone: proposal.tone,
    recipientName: proposal.recipientName,
    discountUsd: proposal.discountUsd,
    createdAt: proposal.createdAt,
    phases: phases
      .map((p) => ({
        id: p.id,
        branch: p.branch,
        name: p.name,
        deliverables: p.deliverables,
        priceUsd: p.priceUsd,
        weeks: p.weeks,
        enabled: p.enabled,
        order: p.order,
        findingIds: p.findingIds,
      }))
      .sort((a, b) => a.order - b.order),
    blocks: blocks
      .map((b) => ({
        id: b.id,
        type: b.type,
        name: b.name,
        enabled: b.enabled,
        order: b.order,
        content: b.content,
      }))
      .sort((a, b) => a.order - b.order),
    findings: usable,
  };
}
