"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Barra de pestañas de 40 px (handoff §6).
 *
 * Las siete pestañas están desde el principio porque son el mapa mental de la
 * herramienta, pero solo se enlazan las que existen. Una pestaña que navega a
 * una pantalla vacía miente más que una pestaña visiblemente pendiente, así que
 * las no construidas van apagadas y dicen por qué.
 */

interface Tab {
  label: string;
  href?: string;
  count?: number;
  /** Por qué no se puede pinchar todavía. */
  pendingNote?: string;
  /** Coincide con esta ruta además de con `href`. */
  matchPrefix?: string;
}

export function TabBar({
  counts,
  lastScanLabel,
  expedienteHref,
  propuestaHref,
}: {
  counts: { review: number; proposals: number; pipeline: number };
  lastScanLabel: string | null;
  /**
   * El expediente es de *un* prospecto, así que la pestaña solo lleva a algún
   * sitio cuando hay uno elegido. Sin selección se queda apagada explicándolo,
   * que es más honesto que llevar a una pantalla que pregunta lo mismo.
   */
  expedienteHref?: string | null;
  /** Igual que el expediente: la propuesta es de un prospecto concreto. */
  propuestaHref?: string | null;
}) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { label: "Mapa", href: "/" },
    { label: "Revisión", href: "/revision", count: counts.review },
    expedienteHref
      ? { label: "Expediente", href: expedienteHref, matchPrefix: "/expediente" }
      : { label: "Expediente", pendingNote: "Elige antes un prospecto en el mapa" },
    propuestaHref
      ? {
          label: "Propuestas",
          href: propuestaHref,
          count: counts.proposals,
          matchPrefix: "/propuestas",
        }
      : {
          label: "Propuestas",
          count: counts.proposals,
          pendingNote: "Elige antes un prospecto en el mapa",
        },
    { label: "Pipeline", href: "/pipeline", count: counts.pipeline },
    { label: "Traza", pendingNote: "La traza se escribe ya en la base; la pantalla viene después" },
    { label: "Zonas", href: "/zonas" },
  ];

  return (
    <nav className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-3">
      {tabs.map((tab) => {
        const active =
          (tab.href !== undefined && pathname === tab.href) ||
          (tab.matchPrefix !== undefined && pathname.startsWith(tab.matchPrefix));

        const content = (
          <>
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 font-mono text-xs2" style={{ color: "var(--dim)" }}>
                {tab.count}
              </span>
            )}
          </>
        );

        if (tab.href) {
          return (
            <Link
              key={tab.label}
              href={tab.href}
              className={`flex h-7 items-center rounded-[7px] px-2.5 text-base whitespace-nowrap transition-colors ${
                active ? "bg-chip text-foreground" : "text-muted-foreground hover:bg-hover"
              }`}
            >
              {content}
            </Link>
          );
        }

        return (
          <span
            key={tab.label}
            title={tab.pendingNote}
            className="flex h-7 cursor-not-allowed items-center rounded-[7px] px-2.5 text-base whitespace-nowrap opacity-45"
            style={{ color: "var(--muted)" }}
          >
            {content}
          </span>
        );
      })}

      {lastScanLabel && (
        <span className="ml-auto flex items-center gap-1.5 font-mono text-xs2 whitespace-nowrap">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--accent)" }}
            aria-hidden
          />
          <span style={{ color: "var(--dim)" }}>último escaneo {lastScanLabel}</span>
        </span>
      )}
    </nav>
  );
}
