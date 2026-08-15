/**
 * Un hallazgo en el expediente completo (handoff §6.2).
 *
 * Rejilla de dos columnas `1fr 496px`: a la izquierda el argumento —qué pasa y
 * qué gana el cliente— y a la derecha la prueba. Ese reparto es la tesis de la
 * pantalla: nada de lo de la izquierda se sostiene sin lo de la derecha, y
 * ponerlos lado a lado obliga a leerlos juntos.
 *
 * Por debajo de 1100 px la rejilla se apila; la evidencia queda debajo del
 * argumento en vez de encogerse hasta ser ilegible.
 */

import { BRANCH_META, type Branch } from "@borsoga/shared";
import {
  SEVERITY_LABEL,
  VERDICT_LABEL,
  branchColor,
  severityColor,
  timeAgo,
} from "@/lib/display";
import type { FullFinding } from "@/lib/queries";
import { EvidenceCard } from "./evidence-card";

function Tag({ label, color, background }: { label: string; color: string; background: string }) {
  return (
    <span
      className="rounded-[5px] px-1.5 py-0.5 text-2xs whitespace-nowrap"
      style={{ color, background }}
    >
      {label}
    </span>
  );
}

export function FindingBlock({ finding, now }: { finding: FullFinding; now: Date }) {
  const branch: Branch = finding.branch;

  return (
    <article
      // Ancla para "clic en un hallazgo del resumen → expediente, con scroll
      // hasta ese hallazgo" (handoff §8). `scroll-mt` deja hueco para la
      // cabecera fija, si no el título queda oculto debajo.
      id={`hallazgo-${finding.id}`}
      className="grid scroll-mt-4 gap-5 border-t border-line-soft py-5 first:border-0"
      style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 496px)" }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag
            label={VERDICT_LABEL[finding.verdict]}
            color={finding.verdict === "confirmed" ? "var(--ok)" : "var(--muted)"}
            background="var(--chip)"
          />
          <Tag
            label={SEVERITY_LABEL[finding.severity]}
            color={severityColor(finding.severity)}
            background="var(--inset)"
          />
          {finding.recheckCount > 0 && (
            <span className="font-mono text-2xs" style={{ color: "var(--dim2)" }}>
              reverificado ×{finding.recheckCount}
            </span>
          )}
        </div>

        <h3 className="mt-1.5 text-xl leading-snug font-medium">{finding.title}</h3>

        <p
          className="mt-1.5 max-w-[620px] text-base2"
          style={{ color: "var(--muted)", lineHeight: 1.55 }}
        >
          {finding.description}
        </p>

        {finding.reviewNote && (
          <p className="mt-2 max-w-[620px] text-base2 italic" style={{ color: "var(--dim)" }}>
            Nota de revisión: {finding.reviewNote}
          </p>
        )}

        {/* "Lo que gana el cliente": borde izquierdo de 2 px del color de la rama. */}
        <div
          className="mt-3 max-w-[620px] border-l-2 pl-3"
          style={{ borderColor: branchColor(branch) }}
        >
          <h4 className="text-2xs font-medium tracking-wide uppercase" style={{ color: "var(--dim)" }}>
            Lo que gana el cliente
          </h4>
          <p className="mt-1 text-base2" style={{ color: "var(--text2)", lineHeight: 1.55 }}>
            {finding.clientGain}
          </p>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {/*
           * `finding.recheck` es un tipo de trabajo que la cola contempla y el
           * worker todavía rechaza. Se deja el control en su sitio y apagado en
           * vez de encolar algo que nadie va a atender.
           */}
          <button
            type="button"
            disabled
            title="La reverificación llega en el paso 6, con la cola de revisión"
            className="h-7 cursor-not-allowed rounded-md border border-line2 px-2.5 text-sm2 whitespace-nowrap opacity-45"
            style={{ color: "var(--muted)" }}
          >
            Reverificar con IA
          </button>
          <span className="font-mono text-2xs" style={{ color: "var(--dim2)" }}>
            verificado {timeAgo(finding.verifiedAt, now)}
          </span>
        </div>
      </div>

      <EvidenceCard evidence={finding.evidence} />
    </article>
  );
}

/** Una sección por rama, con su recuento, ticket y score sobre una divisoria. */
export function BranchSection({
  branch,
  findings,
  score,
  ticket,
  now,
  money,
}: {
  branch: Branch;
  findings: FullFinding[];
  score: number;
  ticket: number;
  now: Date;
  money: (usd: number) => string;
}) {
  const meta = BRANCH_META[branch];

  return (
    <section className="mt-8 first:mt-0">
      <header className="flex items-baseline gap-2 border-b border-line pb-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: branchColor(branch) }}
          aria-hidden
        />
        <h2 className="text-2xl font-medium">{meta.label}</h2>
        <span className="font-mono text-sm2" style={{ color: "var(--dim)" }}>
          {findings.length}
        </span>
        <span className="ml-auto flex items-baseline gap-3">
          <span className="font-mono text-sm2" style={{ color: "var(--dim)" }}>
            {money(ticket)}
          </span>
          <span className="font-mono text-2xl font-medium" style={{ color: branchColor(branch) }}>
            {score}
          </span>
        </span>
      </header>

      {findings.map((f) => (
        <FindingBlock key={f.id} finding={f} now={now} />
      ))}
    </section>
  );
}
