/**
 * Expediente completo (handoff §6.2). Paso 5 del orden de construcción.
 *
 * Cabecera fija con las cuatro cifras que se miran antes de decidir nada, y
 * cuerpo con scroll: una sección por rama, y dentro cada hallazgo con su
 * argumento a la izquierda y su prueba a la derecha.
 *
 * Se llega desde "Abrir expediente" del resumen o pinchando un hallazgo, y se
 * vuelve al mapa conservando la selección — de ahí que el enlace de volver
 * lleve el `?p=` de este prospecto.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BRANCHES, COUNTY_LABEL, SECTOR_LABEL, type Branch } from "@borsoga/shared";
import { getFullDossier, getNavCounts, getQuota, getZone } from "@/lib/queries";
import { ICP_FIT_LABEL, money, moneyExact, scoreColor, timeAgo } from "@/lib/display";
import { AppHeader } from "@/components/shell/app-header";
import { TabBar } from "@/components/shell/tab-bar";
import { BranchSection } from "@/components/expediente/finding-block";

export const dynamic = "force-dynamic";

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-3xl leading-none font-medium" style={{ color }}>
        {value}
      </div>
      <div className="mt-0.5 text-2xs whitespace-nowrap" style={{ color: "var(--dim)" }}>
        {label}
      </div>
    </div>
  );
}

export default async function ExpedientePage({ params }: PageProps<"/expediente/[id]">) {
  const { id } = await params;

  const [dossier, zone, quota, navCounts] = await Promise.all([
    getFullDossier(id),
    getZone(),
    getQuota(),
    getNavCounts(),
  ]);

  if (!dossier) notFound();

  /*
   * Una sola marca de tiempo para toda la página. Si cada "hace 3 h" llamara a
   * `new Date()` por su cuenta, dos hallazgos verificados a la vez podrían
   * mostrar textos distintos según el milisegundo en que se renderizaron.
   */
  const now = new Date();

  const confirmed = dossier.fullFindings.filter((f) => f.verdict === "confirmed").length;

  const sections = BRANCHES.map((branch: Branch) => ({
    branch,
    findings: dossier.fullFindings.filter((f) => f.branch === branch),
    score: dossier.branchScores[branch] ?? 0,
    ticket: dossier.branchTickets[branch] ?? 0,
  })).filter((s) => s.findings.length > 0);

  const domain = dossier.website
    ? dossier.website.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader zone={zone} quota={quota} />
      <TabBar
        counts={navCounts}
        lastScanLabel={null}
        expedienteHref={`/expediente/${dossier.id}`}
        propuestaHref={`/propuestas/${dossier.id}`}
      />

      <header className="shrink-0 border-b border-line bg-panel px-4 py-3">
        <div className="flex items-start gap-3">
          <Link
            href={`/?p=${dossier.id}`}
            aria-label="Volver al mapa"
            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line2 bg-field text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <ArrowLeft size={15} />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-4xl font-medium">{dossier.name}</h1>
              <span
                className="rounded-[6px] px-1.5 py-0.5 text-2xs whitespace-nowrap"
                style={{ background: "var(--accent-soft)", color: "var(--accent2)" }}
              >
                {ICP_FIT_LABEL[dossier.icpFit]}
              </span>
              {dossier.disqualified && (
                <span
                  className="rounded-[6px] px-1.5 py-0.5 text-2xs whitespace-nowrap"
                  style={{ background: "var(--inset)", color: "var(--dim2)" }}
                >
                  Descartado
                </span>
              )}
            </div>

            <p className="mt-1 truncate font-mono text-2xs" style={{ color: "var(--dim)" }}>
              {[
                dossier.sectors.map((s) => SECTOR_LABEL[s]).join(" · ") || null,
                dossier.city,
                COUNTY_LABEL[dossier.county],
                domain,
                dossier.employeesEstimate ? `~${dossier.employeesEstimate} empleados` : null,
                `verificado ${timeAgo(dossier.lastScannedAt, now)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex shrink-0 items-start gap-5">
            <Figure
              label="score"
              value={String(dossier.score)}
              color={scoreColor(dossier.score, dossier.disqualified)}
            />
            <Figure label="hallazgos" value={String(dossier.fullFindings.length)} />
            <Figure label="confirmados" value={String(confirmed)} />
            <Figure label="ticket" value={money(dossier.ticketEstimate)} />

            <Link
              href={`/propuestas/${dossier.id}`}
              className="mt-1 grid h-8 place-items-center rounded-md px-3 text-base whitespace-nowrap transition-colors"
              style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
            >
              Generar propuesta
            </Link>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-[1240px]">
          {sections.length === 0 ? (
            <p className="text-base2" style={{ color: "var(--muted)" }}>
              Este prospecto todavía no tiene hallazgos. El worker aún no lo ha auditado.
            </p>
          ) : (
            sections.map((s) => (
              <BranchSection
                key={s.branch}
                branch={s.branch}
                findings={s.findings}
                score={s.score}
                ticket={s.ticket}
                now={now}
                money={money}
              />
            ))
          )}

          {/* Viabilidad comercial: prosa honesta, no un score más. */}
          <section className="mt-8 rounded-xl border border-line bg-card p-4">
            <h2 className="text-2xl font-medium">Viabilidad comercial</h2>
            <p
              className="mt-2 max-w-[760px] text-base2"
              style={{ color: "var(--text2)", lineHeight: 1.55 }}
            >
              {dossier.commercialViability ||
                "El auditor no dejó valoración comercial para este prospecto."}
            </p>

            {dossier.growthSignals.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {dossier.growthSignals.map((s) => (
                  <li
                    key={s}
                    className="rounded-[6px] px-1.5 py-0.5 text-2xs"
                    style={{ background: "var(--warn-soft)", color: "var(--warn2)" }}
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 font-mono text-2xs" style={{ color: "var(--dim2)" }}>
              ticket estimado {moneyExact(dossier.ticketEstimate)} · etapa {dossier.stage}
            </p>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled
                title="El pipeline llega en el paso 8"
                className="h-8 cursor-not-allowed rounded-md px-3 text-base whitespace-nowrap opacity-45"
                style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
              >
                Añadir al pipeline
              </button>
              <button
                type="button"
                disabled
                title="Descartar a mano llega con la cola de revisión, en el paso 6"
                className="h-8 cursor-not-allowed rounded-md border border-line2 px-3 text-base whitespace-nowrap opacity-45"
                style={{ color: "var(--muted)" }}
              >
                Descartar
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
