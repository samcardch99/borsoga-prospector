/**
 * Expediente resumido: columna derecha de 372 px (handoff §6.1).
 *
 * OJO con el contenedor con scroll. El handoff avisa de un error ya cometido:
 * tiene que ser `flex flex-col` con `gap`, **no** un grid. Un grid con altura
 * definida comprime las filas en lugar de desbordar, y las tarjetas recortan
 * hallazgos sin que llegue a aparecer la barra de scroll — el fallo se ve como
 * "faltan hallazgos", no como un problema de layout, y cuesta encontrarlo.
 */

import Link from "next/link";
import { BRANCH_META, type Branch } from "@borsoga/shared";
import type { Dossier, DossierFinding } from "@/lib/queries";
import {
  ICP_FIT_LABEL,
  VERDICT_SHORT,
  branchColor,
  money,
  moneyExact,
  scoreColor,
  severityColor,
} from "@/lib/display";

const BRANCH_ORDER: readonly Branch[] = ["renders", "web", "branding"];

/** Hasta tres por rama en el resumen; el recuento que se muestra es el real. */
const MAX_PER_BRANCH = 3;

function Chip({ children, tone }: { children: React.ReactNode; tone?: "brand" | "ok" }) {
  const style =
    tone === "brand"
      ? { background: "var(--accent-soft)", color: "var(--accent2)" }
      : tone === "ok"
        ? { background: "var(--warn-soft)", color: "var(--warn2)" }
        : { background: "var(--chip)", color: "var(--muted)" };

  return (
    <span className="rounded-[6px] px-1.5 py-0.5 text-2xs whitespace-nowrap" style={style}>
      {children}
    </span>
  );
}

function FindingLine({ finding, prospectId }: { finding: DossierFinding; prospectId: string }) {
  return (
    <Link
      href={`/expediente/${prospectId}#hallazgo-${finding.id}`}
      className="-mx-1 flex gap-2 rounded-md border-t border-line-soft px-1 pt-2 transition-colors first:border-0 first:pt-0 hover:bg-hover"
    >
      <span
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: severityColor(finding.severity) }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-sm2 leading-snug">{finding.title}</span>
          <span className="shrink-0 font-mono text-2xs" style={{ color: "var(--dim2)" }}>
            {VERDICT_SHORT[finding.verdict]}
          </span>
        </div>
        <div className="truncate font-mono text-2xs" style={{ color: "var(--dim2)" }}>
          {finding.evidenceUrl}
        </div>
      </div>
    </Link>
  );
}

function BranchCard({
  branch,
  findings,
  score,
  ticket,
  prospectId,
}: {
  branch: Branch;
  findings: DossierFinding[];
  score: number;
  ticket: number;
  prospectId: string;
}) {
  const meta = BRANCH_META[branch];
  const shown = findings.slice(0, MAX_PER_BRANCH);
  const hidden = findings.length - shown.length;

  return (
    <section className="rounded-xl border border-line bg-card p-2.5">
      <header className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: branchColor(branch) }}
          aria-hidden
        />
        <h3 className="text-base2 font-medium">{meta.label}</h3>
        <span className="font-mono text-2xs" style={{ color: "var(--dim)" }}>
          {findings.length}
        </span>
        <span className="ml-auto flex items-baseline gap-2">
          <span className="font-mono text-2xs" style={{ color: "var(--dim)" }}>
            {money(ticket)}
          </span>
          <span className="font-mono text-sm2 font-medium" style={{ color: scoreColor(score) }}>
            {score}
          </span>
        </span>
      </header>

      <div className="mt-2 flex flex-col gap-2">
        {shown.map((f) => (
          <FindingLine key={f.id} finding={f} prospectId={prospectId} />
        ))}
        {hidden > 0 && (
          <p className="text-2xs" style={{ color: "var(--dim2)" }}>
            +{hidden} {hidden === 1 ? "hallazgo más" : "hallazgos más"} en el expediente completo
          </p>
        )}
      </div>
    </section>
  );
}

export function DossierSummary({ dossier }: { dossier: Dossier | null }) {
  if (!dossier) {
    return (
      <aside className="flex w-[372px] shrink-0 flex-col items-center justify-center border-l border-line bg-panel px-6">
        <p className="text-center text-sm2" style={{ color: "var(--muted)" }}>
          Elige un prospecto en la lista o en el mapa para ver su expediente.
        </p>
      </aside>
    );
  }

  const google = dossier.ratings.find((r) => r.source === "google");
  const houzz = dossier.ratings.find((r) => r.source === "houzz");

  const byBranch = BRANCH_ORDER.map((branch) => ({
    branch,
    findings: dossier.findings.filter((f) => f.branch === branch),
    score: dossier.branchScores[branch] ?? 0,
    ticket: dossier.branchTickets[branch] ?? 0,
  })).filter((b) => b.findings.length > 0);

  return (
    <aside className="flex w-[372px] shrink-0 flex-col border-l border-line bg-panel">
      <header className="shrink-0 border-b border-line px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-md2 font-medium">{dossier.name}</h2>
            <p className="truncate text-sm" style={{ color: "var(--muted)" }}>
              {dossier.address}
            </p>
          </div>
          <span
            className="shrink-0 font-mono text-4xl leading-none font-bold"
            style={{ color: scoreColor(dossier.score, dossier.disqualified) }}
          >
            {dossier.score}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {google && (
            <span className="font-mono text-2xs" style={{ color: "var(--dim)" }}>
              Google {google.score.toFixed(1)} ({google.reviewCount})
            </span>
          )}
          {houzz && (
            <span className="font-mono text-2xs" style={{ color: "var(--dim)" }}>
              Houzz {houzz.score.toFixed(1)} ({houzz.reviewCount})
            </span>
          )}
          {dossier.employeesEstimate !== null && (
            <span className="font-mono text-2xs" style={{ color: "var(--dim)" }}>
              ~{dossier.employeesEstimate} empleados
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone="brand">{ICP_FIT_LABEL[dossier.icpFit]}</Chip>
          {dossier.growthSignals.slice(0, 1).map((s) => (
            <Chip key={s} tone="ok">
              {s}
            </Chip>
          ))}
        </div>

        {dossier.disqualified && dossier.disqualifyNote && (
          <p className="mt-2 text-sm italic" style={{ color: "var(--dim2)" }}>
            {dossier.disqualifyNote}
          </p>
        )}
      </header>

      {/* flex-col + gap, NUNCA grid: ver la nota de arriba. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {byBranch.length === 0 ? (
          <p className="text-sm2" style={{ color: "var(--muted)" }}>
            Sin hallazgos todavía. El worker aún no ha auditado este prospecto.
          </p>
        ) : (
          <>
            {byBranch.map((b) => (
              <BranchCard
                key={b.branch}
                branch={b.branch}
                findings={b.findings}
                score={b.score}
                ticket={b.ticket}
                prospectId={dossier.id}
              />
            ))}

            <section
              className="rounded-xl border p-2.5"
              style={{ borderColor: "var(--accent-line)", background: "var(--accent-soft)" }}
            >
              <h3 className="text-sm2 font-medium" style={{ color: "var(--accent2)" }}>
                Propuesta sugerida
              </h3>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold" style={{ color: "var(--accent2)" }}>
                  {moneyExact(dossier.ticketEstimate)}
                </span>
                <span className="font-mono text-2xs" style={{ color: "var(--accent2)" }}>
                  {byBranch.length} {byBranch.length === 1 ? "rama" : "ramas"}
                </span>
              </p>
            </section>
          </>
        )}
      </div>

      <footer className="flex shrink-0 gap-2 border-t border-line px-3 py-2.5">
        {/*
         * Las dos pantallas de destino son de pasos posteriores (expediente
         * completo el 5, propuestas el 7). Se dejan visibles y apagadas: son
         * parte del diseño de esta columna, y esconderlas cambiaría el layout
         * que hay que recrear.
         */}
        <Link
          href={`/expediente/${dossier.id}`}
          className="grid h-8 flex-1 place-items-center rounded-md text-base whitespace-nowrap transition-colors"
          style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
        >
          Abrir expediente
        </Link>
        <Link
          href={`/propuestas/${dossier.id}`}
          className="grid h-8 flex-1 place-items-center rounded-md border border-line2 text-base whitespace-nowrap transition-colors hover:bg-hover"
          style={{ color: "var(--text2)" }}
        >
          Generar propuesta
        </Link>
      </footer>
    </aside>
  );
}
