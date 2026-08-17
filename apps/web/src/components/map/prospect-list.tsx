/**
 * Lista izquierda de 336 px (handoff §6.1).
 *
 * Sin JavaScript de cliente: cada fila es un enlace y tanto la selección como
 * los filtros viven en la URL. Eso da tres cosas gratis que el estado local no
 * da — recargar no pierde la selección, el enlace se puede compartir, y el
 * expediente de la derecha se renderiza en el servidor con el prospecto ya
 * elegido en vez de esperar a una hidratación.
 */

import Link from "next/link";
import { BRANCH_META, DISQUALIFY_LABEL, SECTOR_LABEL, type Branch } from "@borsoga/shared";
import type { ProspectRow } from "@/lib/queries";
import { branchColor, money, scoreColor, scoreSurface } from "@/lib/display";

export type ListFilter = "icp" | "nuevo" | "desc";

const BRANCH_ORDER: readonly Branch[] = ["renders", "web", "branding"];

/**
 * Los tres chips del handoff. Cada uno estrecha la lista y se combinan en Y.
 *
 * `desc` es el raro y conviene leerlo: no estrecha, *incluye*. Los descartados
 * se ocultan por defecto, así que un chip que filtrara hacia ellos daría
 * siempre cero. Aquí los trae a la lista, en gris y con su motivo, que es lo
 * que el equipo necesita para corregir los filtros (handoff §5).
 */
export function applyFilters(rows: ProspectRow[], filters: Set<ListFilter>): ProspectRow[] {
  return rows.filter((r) => {
    if (r.disqualified && !filters.has("desc")) return false;
    if (filters.has("icp") && r.icpFit === "low") return false;
    if (filters.has("nuevo") && r.contacted) return false;
    return true;
  });
}

function toggleHref(
  filters: Set<ListFilter>,
  filter: ListFilter,
  selectedId: string | null,
): string {
  const next = new Set(filters);
  if (next.has(filter)) next.delete(filter);
  else next.add(filter);

  const params = new URLSearchParams();
  if (next.size > 0) params.set("f", [...next].join(","));
  if (selectedId) params.set("p", selectedId);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function rowHref(id: string, filters: Set<ListFilter>): string {
  const params = new URLSearchParams();
  if (filters.size > 0) params.set("f", [...filters].join(","));
  params.set("p", id);
  return `/?${params.toString()}`;
}

function FilterChip({
  label,
  count,
  active,
  href,
}: {
  label: string;
  count: number;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`flex h-6 items-center gap-1.5 rounded-[7px] border px-2 text-xs2 whitespace-nowrap transition-colors ${
        active
          ? "border-transparent bg-chip text-foreground"
          : "border-line2 text-muted-foreground hover:bg-hover"
      }`}
    >
      {label}
      <span className="font-mono" style={{ color: active ? "var(--dim)" : "var(--dim2)" }}>
        {count}
      </span>
    </Link>
  );
}

function ProspectRowItem({
  row,
  selected,
  href,
}: {
  row: ProspectRow;
  selected: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      className={`flex gap-2.5 border-b border-line-soft px-3 py-2.5 transition-colors ${
        selected ? "bg-chip" : "hover:bg-hover"
      }`}
      // Los descartados al 55 %: siguen ahí, pero no compiten por la atención.
      style={row.disqualified ? { opacity: 0.55 } : undefined}
    >
      <div
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md font-mono text-base font-medium"
        style={{
          background: scoreSurface(row.score, row.disqualified),
          color: scoreColor(row.score, row.disqualified),
        }}
      >
        {row.score}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-base2 font-medium">{row.name}</div>
        <div className="truncate text-sm" style={{ color: "var(--muted)" }}>
          {row.sectors.map((s) => SECTOR_LABEL[s]).join(" · ") || "Sector sin clasificar"}
          {" · "}
          {row.city}
        </div>

        <div className="mt-1.5 flex items-center gap-1.5">
          {BRANCH_ORDER.map((branch) => {
            const n = row.branchCounts[branch] ?? 0;
            if (n === 0) return null;
            return (
              <span
                key={branch}
                title={`${BRANCH_META[branch].label}: ${n} ${n === 1 ? "hallazgo" : "hallazgos"}`}
                className="flex items-center gap-0.5 font-mono text-2xs"
                style={{ color: branchColor(branch) }}
              >
                <span className="font-medium">{BRANCH_META[branch].letter}</span>
                {n}
              </span>
            );
          })}

          <span className="ml-auto font-mono text-xs2" style={{ color: "var(--dim)" }}>
            {money(row.ticketEstimate)}
          </span>
        </div>

        {row.disqualified && (
          <div className="mt-1 text-xs italic" style={{ color: "var(--dim2)" }}>
            {row.disqualifyNote ||
              (row.disqualifyReason ? DISQUALIFY_LABEL[row.disqualifyReason] : "Descartado")}
          </div>
        )}
      </div>
    </Link>
  );
}

export function ProspectList({
  rows,
  visible,
  filters,
  selectedId,
  exportHref,
  zoneName,
}: {
  /** Todos los de la zona: los chips necesitan su recuento aunque estén ocultos. */
  rows: ProspectRow[];
  visible: ProspectRow[];
  filters: Set<ListFilter>;
  selectedId: string | null;
  exportHref: string;
  zoneName?: string | null;
}) {
  const counts = {
    icp: rows.filter((r) => !r.disqualified && r.icpFit !== "low").length,
    nuevo: rows.filter((r) => !r.disqualified && !r.contacted).length,
    desc: rows.filter((r) => r.disqualified).length,
  };

  return (
    <aside className="flex w-[336px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base2 font-medium">Prospectos en la zona</h2>
          <span className="font-mono text-xs2" style={{ color: "var(--dim)" }}>
            {visible.length}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <FilterChip
            label="Encaje ICP"
            count={counts.icp}
            active={filters.has("icp")}
            href={toggleHref(filters, "icp", selectedId)}
          />
          <FilterChip
            label="Sin contactar"
            count={counts.nuevo}
            active={filters.has("nuevo")}
            href={toggleHref(filters, "nuevo", selectedId)}
          />
          <FilterChip
            label="Descartados"
            count={counts.desc}
            active={filters.has("desc")}
            href={toggleHref(filters, "desc", selectedId)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          /*
           * Dos vacíos distintos y no dan la misma información: "los filtros no
           * dejan pasar nada" se arregla tocando los chips; "esta zona no se ha
           * escaneado" se arregla escaneando.
           */
          rows.length === 0 ? (
            <div className="px-3 py-6">
              <p className="text-sm2" style={{ color: "var(--muted)" }}>
                {zoneName ? `Nadie ha escaneado ${zoneName} todavía.` : "No hay ninguna zona configurada."}
              </p>
              <p className="mt-1.5 text-2xs" style={{ color: "var(--dim2)" }}>
                Lánzalo desde la vista de Zonas. El worker escribe aquí en cuanto termina el
                primer prospecto.
              </p>
            </div>
          ) : (
            <p className="px-3 py-6 text-sm2" style={{ color: "var(--muted)" }}>
              Ningún prospecto encaja con estos filtros.
            </p>
          )
        ) : (
          visible.map((row) => (
            <ProspectRowItem
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              href={rowHref(row.id, filters)}
            />
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-line px-3 py-2 text-xs2">
        <span style={{ color: "var(--dim)" }}>Orden: score descendente</span>
        <a href={exportHref} download className="font-mono" style={{ color: "var(--accent)" }}>
          Exportar JSON
        </a>
      </div>
    </aside>
  );
}
