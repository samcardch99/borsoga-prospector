"use client";

/**
 * Panel de configuración de la propuesta (handoff §6.4, modo "Configurar").
 *
 * Fases activables, su precio y sus entregables, y el desglose al final. El
 * modo "Editar" —bloques arrastrables, tono, reescritura con IA— es la segunda
 * mitad del paso 7 según el propio orden del handoff, y todavía no está.
 *
 * El precio de cada fase no se edita aquí. Sale del score real de esa rama, y
 * un campo editable invitaría a inventar una cifra que ya no correspondería a
 * los hallazgos que la propuesta cita dos columnas más allá.
 */

import { useState, useTransition } from "react";
import { moneyExact } from "@/lib/display";
import type { LoadedProposal } from "@/lib/proposals";
import { setDiscount, togglePhase } from "@/app/propuestas/actions";

export function ConfigPanel({
  proposal,
  totals,
}: {
  proposal: LoadedProposal;
  totals: { subtotal: number; discount: number; total: number };
}) {
  const [pending, startTransition] = useTransition();
  const [discount, setDiscountDraft] = useState(String(proposal.discountUsd));

  function onToggle(phaseId: string, enabled: boolean) {
    startTransition(async () => {
      await togglePhase(proposal.id, phaseId, enabled);
    });
  }

  function onDiscountBlur() {
    const parsed = Number(discount.replace(/[^\d]/g, ""));
    startTransition(async () => {
      await setDiscount(proposal.id, Number.isFinite(parsed) ? parsed : 0);
    });
  }

  return (
    <aside className="flex w-[396px] shrink-0 flex-col border-r border-line bg-panel print:hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <h2 className="text-base2 font-medium">Configurar</h2>
        <span
          className="cursor-not-allowed rounded-[6px] px-1.5 py-0.5 text-2xs opacity-45"
          title="El modo de edición es la segunda mitad del paso 7"
          style={{ background: "var(--chip)", color: "var(--muted)" }}
        >
          Editar
        </span>
        <span className="ml-auto font-mono text-2xs" style={{ color: "var(--dim2)" }}>
          {pending ? "guardando…" : "borrador"}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {proposal.phases.length === 0 ? (
          <p className="text-sm2" style={{ color: "var(--muted)" }}>
            No hay fases: este prospecto no tiene hallazgos que proponer.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {proposal.phases.map((phase) => (
              <li
                key={phase.id}
                className="rounded-xl border border-line bg-card p-2.5"
                style={phase.enabled ? undefined : { opacity: 0.55 }}
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={phase.enabled}
                    onChange={(e) => onToggle(phase.id, e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 text-base2 font-medium">{phase.name}</span>
                      <span className="font-mono text-sm2 tabular-nums whitespace-nowrap">
                        {moneyExact(phase.priceUsd)}
                      </span>
                    </span>
                    <span className="mt-0.5 block font-mono text-2xs" style={{ color: "var(--dim)" }}>
                      {phase.weeks} · {phase.findingIds.length}{" "}
                      {phase.findingIds.length === 1 ? "hallazgo" : "hallazgos"}
                    </span>
                  </span>
                </label>

                <ul className="mt-2 ml-5.5 flex flex-col gap-0.5">
                  {phase.deliverables.map((d) => (
                    <li key={d} className="flex gap-1.5 text-2xs" style={{ color: "var(--muted)" }}>
                      <span style={{ color: "var(--dim3)" }}>—</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="shrink-0 border-t border-line p-3">
        <dl className="font-mono text-sm2">
          <div className="flex justify-between">
            <dt style={{ color: "var(--dim)" }}>Subtotal</dt>
            <dd className="tabular-nums">{moneyExact(totals.subtotal)}</dd>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <dt style={{ color: "var(--dim)" }}>Descuento</dt>
            <dd>
              <input
                value={discount}
                onChange={(e) => setDiscountDraft(e.target.value)}
                onBlur={onDiscountBlur}
                inputMode="numeric"
                aria-label="Descuento en dólares"
                className="h-7 w-24 rounded-md border border-line2 bg-field px-2 text-right font-mono text-sm2 tabular-nums"
              />
            </dd>
          </div>
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-md font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">{moneyExact(totals.total)}</dd>
          </div>
        </dl>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled
            title="El envío por email llega con el pipeline, en el paso 8"
            className="h-8 flex-1 cursor-not-allowed rounded-md text-base whitespace-nowrap opacity-45"
            style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
          >
            Enviar por email
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="h-8 flex-1 rounded-md border border-line2 text-base whitespace-nowrap transition-colors hover:bg-hover"
            style={{ color: "var(--text2)" }}
          >
            PDF
          </button>
        </div>
      </footer>
    </aside>
  );
}
