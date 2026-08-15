/**
 * Vista principal: mapa, lista y expediente resumido con datos reales.
 * Paso 4 del orden de construcción, handoff §6.1.
 *
 * Tres columnas: lista 336 px · mapa fluido · expediente 372 px.
 *
 * La selección y los filtros viajan en la URL (`?p=` y `?f=`), no en estado de
 * cliente. El handoff §11 pide que el servidor sea la fuente de verdad de todo
 * lo persistente y que recargar no pierda el sitio; con la selección en la URL
 * eso sale gratis y el expediente se renderiza ya resuelto en el servidor.
 */

import {
  getDossier,
  getLatestScan,
  getNavCounts,
  getQuota,
  getZone,
  listProspects,
} from "@/lib/queries";
import { timeAgo } from "@/lib/display";
import { AppHeader } from "@/components/shell/app-header";
import { TabBar } from "@/components/shell/tab-bar";
import { MapCanvas } from "@/components/map/map-canvas";
import { DossierSummary } from "@/components/map/dossier-summary";
import { ProspectList, applyFilters, type ListFilter } from "@/components/map/prospect-list";

/**
 * Nada de esto se puede prerenderizar: sale de Postgres y cambia cuando el
 * worker escribe. Declararlo evita que el build intente resolverlo sin
 * DATABASE_URL y falle por una razón que no es la real.
 */
export const dynamic = "force-dynamic";

const VALID_FILTERS: readonly ListFilter[] = ["icp", "nuevo", "desc"];

function parseFilters(raw: string | undefined): Set<ListFilter> {
  if (!raw) return new Set();
  const parts = raw.split(",").filter((p): p is ListFilter =>
    (VALID_FILTERS as readonly string[]).includes(p),
  );
  return new Set(parts);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MapaPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const filters = parseFilters(first(sp.f));
  const requestedId = first(sp.p) ?? null;

  const [zone, quota, navCounts] = await Promise.all([getZone(), getQuota(), getNavCounts()]);

  const [rows, scan] = zone
    ? await Promise.all([listProspects(zone.id), getLatestScan(zone.id)])
    : [[], null];

  const visible = applyFilters(rows, filters);

  /*
   * Un `?p=` que apunta a un prospecto que ya no está en la lista visible (lo
   * escondió un filtro, o el id no existe) no debe dejar la columna derecha
   * mostrando algo que no se ve en el mapa. Se resuelve contra lo visible.
   */
  const selectedId = visible.some((r) => r.id === requestedId) ? requestedId : null;
  const dossier = selectedId ? await getDossier(selectedId) : null;

  const exportParams = new URLSearchParams();
  if (zone) exportParams.set("zona", zone.id);
  if (filters.size > 0) exportParams.set("f", [...filters].join(","));

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader zone={zone} quota={quota} />
      <TabBar
        counts={navCounts}
        lastScanLabel={scan ? timeAgo(scan.startedAt) : null}
        expedienteHref={selectedId ? `/expediente/${selectedId}` : null}
        propuestaHref={selectedId ? `/propuestas/${selectedId}` : null}
      />

      <main className="flex min-h-0 flex-1">
        {zone && rows.length === 0 ? (
          <EmptyZone zoneName={zone.name} />
        ) : (
          <>
            <ProspectList
              rows={rows}
              visible={visible}
              filters={filters}
              selectedId={selectedId}
              exportHref={`/api/prospects?${exportParams.toString()}`}
            />
            <MapCanvas rows={visible} selectedId={selectedId} zone={zone} scan={scan} />
            <DossierSummary dossier={dossier} />
          </>
        )}
      </main>
    </div>
  );
}

/**
 * Vacío de verdad: la zona existe pero no tiene prospectos. No es "no hay
 * resultados" (handoff §7) — dice qué hacer a continuación. El desglose por
 * motivo de descarte llega cuando haya escaneos que descarten algo.
 */
function EmptyZone({ zoneName }: { zoneName: string }) {
  return (
    <div className="grid flex-1 place-items-center px-6">
      <div className="max-w-[520px] text-center">
        <h2 className="text-3xl font-medium">Todavía no hay prospectos en {zoneName}</h2>
        <p className="mt-2 text-base2" style={{ color: "var(--muted)" }}>
          La zona está configurada pero nadie ha escaneado aún, o el escaneo no
          encontró negocios dentro del criterio. El worker escribe aquí en cuanto
          termina el primer trabajo.
        </p>
        <pre
          className="mt-4 overflow-x-auto rounded-lg border border-line2 px-3 py-2.5 text-left font-mono text-xs2"
          style={{ background: "var(--inset)", color: "var(--text2)" }}
        >
          pnpm --filter @borsoga/worker enqueue zone …
        </pre>
      </div>
    </div>
  );
}
