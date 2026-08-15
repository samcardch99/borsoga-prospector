/**
 * Panel de detalle de un paso de la traza (handoff §6.6, columna derecha).
 *
 * Lo que lo hace útil no son la entrada y la salida —eso es un log— sino la
 * tarjeta de abajo: robots.txt respetado, peticiones por segundo y aciertos de
 * caché de Places. El handoff pide que esas señales se expongan a propósito, y
 * el motivo es que son lo que se enseña cuando alguien pregunta si esto va
 * rascando sitios ajenos.
 */

import { moneyExact } from "@/lib/display";
import type { TraceStepRow } from "@/lib/queries";

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;

  return (
    <section className="mt-3">
      <h3 className="text-2xs font-medium tracking-wide uppercase" style={{ color: "var(--dim)" }}>
        {label}
      </h3>
      <pre
        className="mt-1 max-h-[240px] overflow-auto rounded-lg p-2.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap"
        style={{ background: "var(--inset)", color: "var(--text2)" }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function Signal({ label, value, ok }: { label: string; value: string; ok: boolean | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt style={{ color: "var(--dim)" }}>{label}</dt>
      <dd
        className="font-mono tabular-nums"
        style={{ color: ok === null ? "var(--dim2)" : ok ? "var(--ok)" : "var(--crit)" }}
      >
        {value}
      </dd>
    </div>
  );
}

export function StepDetail({ step }: { step: TraceStepRow | null }) {
  if (!step) {
    return (
      <aside className="grid w-[388px] shrink-0 place-items-center border-l border-line bg-panel px-6">
        <p className="text-center text-sm2" style={{ color: "var(--muted)" }}>
          Elige un paso de la tabla para ver qué entró y qué salió.
        </p>
      </aside>
    );
  }

  const tokens =
    step.tokensIn !== null || step.tokensOut !== null
      ? `${(step.tokensIn ?? 0).toLocaleString("es-ES")} → ${(step.tokensOut ?? 0).toLocaleString("es-ES")}`
      : null;

  return (
    <aside className="flex w-[388px] shrink-0 flex-col border-l border-line bg-panel">
      <header className="shrink-0 border-b border-line px-3 py-2.5">
        <h2 className="font-mono text-base2 font-medium">{step.step}</h2>
        <p className="mt-0.5 truncate font-mono text-2xs" style={{ color: "var(--dim)" }}>
          {step.target}
        </p>

        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs">
          {step.model && (
            <div className="flex gap-1.5">
              <dt style={{ color: "var(--dim)" }}>modelo</dt>
              <dd>{step.model}</dd>
            </div>
          )}
          <div className="flex gap-1.5">
            <dt style={{ color: "var(--dim)" }}>duración</dt>
            <dd className="tabular-nums">{(step.durationMs / 1000).toFixed(2)} s</dd>
          </div>
          {step.costUsd > 0 && (
            <div className="flex gap-1.5">
              <dt style={{ color: "var(--dim)" }}>coste</dt>
              <dd className="tabular-nums">{moneyExact(step.costUsd)}</dd>
            </div>
          )}
          {tokens && (
            <div className="flex gap-1.5">
              <dt style={{ color: "var(--dim)" }}>tokens</dt>
              <dd className="tabular-nums">{tokens}</dd>
            </div>
          )}
        </dl>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <Json label="Entrada" value={step.input} />
        <Json label="Salida" value={step.output} />

        <section className="mt-3 rounded-xl border border-line bg-card p-2.5">
          <h3 className="text-sm2 font-medium">Reintentos y buena vecindad</h3>
          <dl className="mt-1.5 flex flex-col gap-1 text-2xs">
            <Signal
              label="Reintentos"
              value={String(step.retries)}
              ok={step.retries === 0 ? true : false}
            />
            <Signal
              label="robots.txt respetado"
              value={step.robotsRespected === null ? "no aplica" : step.robotsRespected ? "sí" : "no"}
              ok={step.robotsRespected}
            />
            <Signal
              label="Peticiones por segundo"
              value={
                step.requestsPerSecond === null ? "no aplica" : step.requestsPerSecond.toFixed(2)
              }
              ok={step.requestsPerSecond === null ? null : step.requestsPerSecond <= 1}
            />
            <Signal
              label="Aciertos de caché de Places"
              value={step.cacheHits === null ? "no aplica" : String(step.cacheHits)}
              ok={step.cacheHits === null ? null : true}
            />
          </dl>
          <p className="mt-2 text-2xs" style={{ color: "var(--dim2)" }}>
            &quot;No aplica&quot; es un paso que no salió a internet: una decisión del agente o
            un cálculo local.
          </p>
        </section>
      </div>
    </aside>
  );
}
