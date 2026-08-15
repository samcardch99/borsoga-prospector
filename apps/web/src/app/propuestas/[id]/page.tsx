/**
 * Generador de propuesta (handoff §6.4). Paso 7 del orden de construcción.
 *
 * Panel de configuración a la izquierda y el documento centrado sobre `--bg`.
 * El propio handoff marca el orden dentro de este paso: "primero configurar y
 * PDF, luego el modo edición", así que eso es lo que hay — el modo de edición
 * con bloques arrastrables y reescritura con IA queda para la segunda mitad.
 *
 * El PDF sale de imprimir el documento. No hay servicio de render ni
 * dependencia nueva: el navegador ya sabe hacer un PDF de una página, y el
 * documento está maquetado para que al imprimir desaparezca todo lo que no es
 * él (ver las utilidades `print:` y el bloque `@media print` de globals.css).
 */

import { notFound } from "next/navigation";
import { getNavCounts, getQuota, getZone } from "@/lib/queries";
import { loadOrCreateProposal, proposalTotals } from "@/lib/proposals";
import { AppHeader } from "@/components/shell/app-header";
import { TabBar } from "@/components/shell/tab-bar";
import { ConfigPanel } from "@/components/propuestas/config-panel";
import { EditPanel } from "@/components/propuestas/edit-panel";
import { ProposalDocument } from "@/components/propuestas/proposal-document";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PropuestaPage({
  params,
  searchParams,
}: PageProps<"/propuestas/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const editing = first(sp.modo) === "editar";
  const selectedBlockId = first(sp.bloque) ?? null;

  const [proposal, zone, quota, navCounts] = await Promise.all([
    loadOrCreateProposal(id),
    getZone(),
    getQuota(),
    getNavCounts(),
  ]);

  if (!proposal) notFound();

  const totals = proposalTotals(proposal.phases, proposal.discountUsd);

  /* El modo y el bloque elegido viajan en la URL, como el resto de la app. */
  const base = `/propuestas/${proposal.prospectId}`;

  return (
    <div className="flex h-screen flex-col overflow-hidden print:h-auto print:overflow-visible">
      <div className="print:hidden">
        <AppHeader zone={zone} quota={quota} />
        <TabBar
          counts={navCounts}
          lastScanLabel={null}
          expedienteHref={`/expediente/${proposal.prospectId}`}
          propuestaHref={`/propuestas/${proposal.prospectId}`}
        />
      </div>

      <main className="flex min-h-0 flex-1 print:block">
        {editing ? (
          <EditPanel
            proposal={proposal}
            selectedBlockId={selectedBlockId}
            hrefFor={{ configurar: base, blockPrefix: `${base}?modo=editar&bloque=` }}
          />
        ) : (
          <ConfigPanel
            proposal={proposal}
            totals={totals}
            editarHref={`${base}?modo=editar`}
          />
        )}

        <div
          className="min-w-0 flex-1 overflow-y-auto p-8 print:overflow-visible print:p-0"
          style={{ background: "var(--bg)" }}
        >
          <ProposalDocument
            proposal={proposal}
            totals={totals}
            selectedBlockId={selectedBlockId}
            editing={editing}
          />
        </div>
      </main>
    </div>
  );
}
