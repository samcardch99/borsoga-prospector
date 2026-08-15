/**
 * Cabecera de 52 px, común a todas las pantallas (handoff §6).
 *
 * Todos los controles miden 32 px, radio 8, borde `--line2`, fondo `--input`.
 * Nada envuelve en dos líneas: `whitespace-nowrap` en las etiquetas y `shrink-0`
 * en los selectores — solo el campo de zona encoge.
 */

import { Crosshair, Search } from "lucide-react";
import { SECTOR_LABEL } from "@borsoga/shared";
import type { QuotaSummary, ZoneSummary } from "@/lib/queries";
import { moneyExact } from "@/lib/display";
import { ThemeToggle } from "./theme-toggle";

function QuotaMeter({ quota }: { quota: QuotaSummary }) {
  const ratio = quota.limit > 0 ? quota.used / quota.limit : 0;
  // Verde hasta el 75 %, aviso hasta el 90 %, crítico por encima. La cuota es
  // un recurso escaso y visible: el punto tiene que cambiar antes de agotarse.
  const dot = ratio >= 0.9 ? "var(--crit)" : ratio >= 0.75 ? "var(--warn)" : "var(--ok)";

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-line2 bg-field px-2.5"
      title={`Cuota de Places del mes: ${quota.used} de ${quota.limit} · ${moneyExact(quota.costUsd)}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      <span className="font-mono text-xs2 whitespace-nowrap text-muted-foreground">
        {quota.used.toLocaleString("es-ES")}/{quota.limit.toLocaleString("es-ES")}
      </span>
    </div>
  );
}

export function AppHeader({
  zone,
  quota,
}: {
  zone: ZoneSummary | null;
  quota: QuotaSummary;
}) {
  const sectorLabel =
    zone && zone.sectors.length > 0
      ? zone.sectors.length === 1
        ? SECTOR_LABEL[zone.sectors[0]]
        : `${zone.sectors.length} sectores`
      : "Todos los sectores";

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-line bg-panel px-3">
      {/* Marca */}
      <div className="flex shrink-0 items-center gap-2">
        <div
          className="grid h-[25px] w-[25px] place-items-center rounded-[7px] text-base font-bold"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          aria-hidden
        >
          B
        </div>
        <span className="text-base whitespace-nowrap">
          <span className="font-medium">Borsoga</span>
          <span className="px-1.5" style={{ color: "var(--dim3)" }}>
            /
          </span>
          <span style={{ color: "var(--muted)" }}>Prospector</span>
        </span>
      </div>

      {/* Centro: zona, sector, ticket mínimo, escanear */}
      <div className="flex max-w-[620px] flex-1 items-center gap-2">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line2 bg-field px-2.5">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-base">
            {zone ? zone.name : "Sin zonas configuradas"}
          </span>
        </div>

        <div className="flex h-8 shrink-0 items-center rounded-md border border-line2 bg-field px-2.5 text-base whitespace-nowrap text-muted-foreground">
          {sectorLabel}
        </div>

        <div className="flex h-8 shrink-0 items-center rounded-md border border-line2 bg-field px-2.5 font-mono text-xs2 whitespace-nowrap text-muted-foreground">
          ≥ {zone ? moneyExact(zone.minTicketUsd) : moneyExact(0)}
        </div>

        {/*
         * El disparo de escaneo es del paso 8, junto con la vista de Zonas.
         * Se deja el control en su sitio y deshabilitado en vez de fingir que
         * funciona: por ahora se encola con el CLI del worker.
         */}
        <button
          type="button"
          disabled
          title="Disponible en el paso 8. Por ahora: pnpm --filter @borsoga/worker enqueue zone …"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-base whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
        >
          <Crosshair size={13} />
          Escanear zona
        </button>
      </div>

      {/* Derecha: cuota, tema, avatar */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <QuotaMeter quota={quota} />
        <ThemeToggle />
        <div
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line2 font-mono text-xs2"
          style={{ background: "var(--chip)", color: "var(--muted)" }}
          title="Borsoga Studio"
        >
          BS
        </div>
      </div>
    </header>
  );
}
