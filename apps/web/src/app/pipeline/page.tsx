/**
 * Pipeline (handoff §6.5). Primera mitad del paso 8.
 *
 * Barra de métricas de 62 px y kanban de seis columnas. "Valor abierto" excluye
 * ganados y perdidos: es lo que sigue vivo, no lo que pasó por aquí.
 */

import { getNavCounts, getPipelineMetrics, getQuota, getZone, listPipeline } from "@/lib/queries";
import { money, moneyExact } from "@/lib/display";
import { AppHeader } from "@/components/shell/app-header";
import { TabBar } from "@/components/shell/tab-bar";
import { Kanban } from "@/components/pipeline/kanban";

export const dynamic = "force-dynamic";

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="shrink-0">
      <div className="font-mono text-2xl leading-none font-medium" style={{ color }}>
        {value}
      </div>
      <div className="mt-1 text-2xs whitespace-nowrap" style={{ color: "var(--dim)" }}>
        {label}
      </div>
    </div>
  );
}

export default async function PipelinePage() {
  const [cards, metrics, zone, quota, navCounts] = await Promise.all([
    listPipeline(),
    getPipelineMetrics(),
    getZone(),
    getQuota(),
    getNavCounts(),
  ]);

  // Una sola marca de tiempo para toda la página: ver la nota del expediente.
  const now = new Date();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader zone={zone} quota={quota} />
      <TabBar counts={navCounts} lastScanLabel={null} />

      <div className="flex h-[62px] shrink-0 items-center gap-8 border-b border-line bg-panel px-4">
        <Metric label="En pipeline" value={String(metrics.inPipeline)} />
        <Metric
          label="Valor abierto"
          value={moneyExact(metrics.openValueUsd)}
          color="var(--accent)"
        />
        <Metric label="Propuestas activas" value={String(metrics.activeProposals)} />
        <Metric
          label="Ganado este trimestre"
          value={`${metrics.wonThisQuarter} · ${money(metrics.wonValueUsd)}`}
          color="var(--ok)"
        />

        <span className="ml-auto font-mono text-2xs" style={{ color: "var(--dim2)" }}>
          {/* Los filtros de responsable y periodo llegan cuando haya usuarios. */}
          sin filtros: todavía no hay responsables asignados
        </span>
      </div>

      {/*
       * Las columnas se pintan aunque no haya tarjetas. Un tablero vacío sigue
       * diciendo cuáles son las etapas y en qué orden van, y eso es la mitad de
       * lo que comunica un kanban; sustituirlo por una frase lo esconde.
       */}
      {cards.length === 0 && (
        <p className="shrink-0 px-4 pt-3 text-base2" style={{ color: "var(--muted)" }}>
          No hay ningún prospecto en juego todavía. Los descartados no entran al pipeline.
        </p>
      )}
      <Kanban cards={cards} now={now} />
    </div>
  );
}
