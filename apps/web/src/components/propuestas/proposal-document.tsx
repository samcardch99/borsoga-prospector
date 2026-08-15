/**
 * El documento de propuesta (handoff §6.4).
 *
 * 720 px sobre `--bg`, con radio 4 en vez de los 9–12 del resto de la interfaz:
 * es papel, no una tarjeta de la herramienta, y esa diferencia de radio es lo
 * que lo separa visualmente de todo lo que lo rodea.
 *
 * Lo que cita en "Lo más urgente" son hallazgos reales con su URL y su fecha.
 * Esa sección es el motivo por el que esta propuesta se puede mandar: no dice
 * "mejoraríamos vuestra web", dice qué se vio, dónde y cuándo.
 */

import { moneyExact } from "@/lib/display";
import type { LoadedProposal, ProposalFinding, ProposalPhase } from "@/lib/proposals";

const MAX_URGENT = 3;

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function UrgentItem({ finding, index }: { finding: ProposalFinding; index: number }) {
  return (
    <li className="mt-4 flex gap-3">
      <span
        className="font-mono text-md2 leading-none font-medium"
        style={{ color: "var(--accent)" }}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-md font-medium">{finding.title}</h4>
        <p className="mt-1 text-base2" style={{ color: "var(--text2)", lineHeight: 1.55 }}>
          {finding.clientGain}
        </p>
        <p className="mt-1 font-mono text-2xs break-all" style={{ color: "var(--dim2)" }}>
          {finding.evidenceUrl} · verificado el {formatDate(finding.capturedAt)}
        </p>
      </div>
    </li>
  );
}

function PhaseRow({ phase }: { phase: ProposalPhase }) {
  return (
    <li className="mt-4 border-t border-line-soft pt-3 first:border-0 first:pt-0">
      <div className="flex items-baseline gap-3">
        <h4 className="min-w-0 flex-1 text-md font-medium">{phase.name}</h4>
        <span className="font-mono text-2xs whitespace-nowrap" style={{ color: "var(--dim)" }}>
          {phase.weeks}
        </span>
        <span className="font-mono text-md whitespace-nowrap tabular-nums">
          {moneyExact(phase.priceUsd)}
        </span>
      </div>
      <ul className="mt-1.5">
        {phase.deliverables.map((d) => (
          <li
            key={d}
            className="flex gap-2 text-base2"
            style={{ color: "var(--text2)", lineHeight: 1.55 }}
          >
            <span style={{ color: "var(--dim3)" }}>—</span>
            <span>{d}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function ProposalDocument({
  proposal,
  totals,
}: {
  proposal: LoadedProposal;
  totals: { subtotal: number; discount: number; total: number };
}) {
  const active = proposal.phases.filter((p) => p.enabled);
  const urgent = proposal.findings.slice(0, MAX_URGENT);

  return (
    <article
      id="documento"
      className="mx-auto w-[720px] max-w-full rounded-doc border border-line bg-panel px-12 py-10 print:w-full print:border-0 print:px-0 print:py-0"
    >
      <header>
        <p
          className="text-2xs font-medium uppercase"
          style={{ color: "var(--dim)", letterSpacing: "0.18em" }}
        >
          Borsoga Studio · Miami
        </p>

        <h1 className="mt-5 text-6xl leading-tight font-bold">
          Propuesta de colaboración
          <br />
          para {proposal.prospectName}
        </h1>

        <p className="mt-3 font-mono text-2xs" style={{ color: "var(--dim)" }}>
          {formatDate(proposal.createdAt)}
          {proposal.recipientName ? ` · a la atención de ${proposal.recipientName}` : ""}
          {` · ${proposal.prospectCity}`}
        </p>
      </header>

      <p
        className="mt-6 text-base2"
        style={{ color: "var(--text2)", lineHeight: 1.65 }}
      >
        Hemos revisado la presencia digital de {proposal.prospectName} y encontrado{" "}
        {proposal.findings.length}{" "}
        {proposal.findings.length === 1 ? "punto concreto" : "puntos concretos"} en los que el
        trabajo que ya hacéis no está llegando a quien lo busca. No es una impresión: cada uno
        de los que siguen se comprobó en vuestro propio sitio, y debajo va la dirección exacta y
        la fecha.
      </p>

      {urgent.length > 0 && (
        <section className="mt-8">
          <h2 className="text-3xl font-bold">Lo más urgente</h2>
          <ol className="mt-2">
            {urgent.map((f, i) => (
              <UrgentItem key={f.id} finding={f} index={i} />
            ))}
          </ol>
        </section>
      )}

      {active.length > 0 && (
        <section className="mt-8">
          <h2 className="text-3xl font-bold">Cómo lo resolvemos</h2>
          <ol className="mt-3">
            {active.map((p) => (
              <PhaseRow key={p.id} phase={p} />
            ))}
          </ol>

          <div className="mt-5 border-t border-line pt-3">
            <dl className="ml-auto w-[280px] font-mono text-base2">
              <div className="flex justify-between">
                <dt style={{ color: "var(--dim)" }}>Subtotal</dt>
                <dd className="tabular-nums">{moneyExact(totals.subtotal)}</dd>
              </div>
              {totals.discount > 0 && (
                <div className="mt-1 flex justify-between">
                  <dt style={{ color: "var(--dim)" }}>Descuento</dt>
                  <dd className="tabular-nums" style={{ color: "var(--ok)" }}>
                    −{moneyExact(totals.discount)}
                  </dd>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-line pt-2 text-md2 font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">{moneyExact(totals.total)}</dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      <section
        className="mt-8 rounded-doc px-5 py-4"
        style={{ background: "var(--accent-soft)" }}
      >
        <h2 className="text-md2 font-medium" style={{ color: "var(--accent2)" }}>
          El siguiente paso
        </h2>
        <p
          className="mt-1 text-base2"
          style={{ color: "var(--accent2)", lineHeight: 1.6 }}
        >
          Una llamada de treinta minutos para repasar juntos los puntos de arriba en vuestro
          propio sitio. Si después de verlo no os parece que merezca la pena, no hay nada más
          que hacer y os quedáis con el diagnóstico.
        </p>
      </section>
    </article>
  );
}
