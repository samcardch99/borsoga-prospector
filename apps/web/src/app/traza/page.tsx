/**
 * Traza (handoff §6.6). La séptima y última pantalla.
 *
 * Con el enfoque agéntico cada fila es una llamada que la IA **decidió** hacer,
 * no un paso de una receta fija. Por eso la tabla es cronológica y sin agrupar:
 * la secuencia —qué miró, en qué orden, cuándo paró— es el dato que hace
 * depurable un agente que se conduce solo.
 */

import Link from "next/link";
import {
  getNavCounts,
  getQuota,
  getTraceScan,
  getZone,
  listTraceSteps,
  type TraceFilter,
  type TraceStatus,
} from "@/lib/queries";
import { moneyExact } from "@/lib/display";
import { AppHeader } from "@/components/shell/app-header";
import { TabBar } from "@/components/shell/tab-bar";
import { LiveRefresh } from "@/components/traza/live-refresh";
import { StepDetail } from "@/components/traza/step-detail";

export const dynamic = "force-dynamic";

/** Las siete columnas del handoff, con sus anchos exactos. */
const GRID = "86px minmax(0,1fr) 168px 74px 74px 68px 84px";

const FILTERS: Array<{ value: TraceFilter; label: string }> = [
  { value: "todos", label: "Todos los pasos" },
  { value: "errores", label: "Solo errores" },
  { value: "ia", label: "Llamadas a IA" },
];

const STATUS_LABEL: Record<TraceStatus, string> = {
  ok: "ok",
  retry: "reintento",
  error: "error",
  timeout: "timeout",
  http_404: "404",
  skipped: "omitido",
};

function statusColor(status: TraceStatus): string {
  if (status === "ok") return "var(--ok)";
  if (status === "retry") return "var(--warn)";
  return "var(--crit)";
}

function parseFilter(raw: string | string[] | undefined): TraceFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "errores" || value === "ia" ? value : "todos";
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clock(date: Date): string {
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function TrazaPage({ searchParams }: PageProps<"/traza">) {
  const sp = await searchParams;
  const filter = parseFilter(sp.f);
  const selectedId = first(sp.paso) ?? null;

  const [scan, zone, quota, navCounts] = await Promise.all([
    getTraceScan(first(sp.scan)),
    getZone(),
    getQuota(),
    getNavCounts(),
  ]);

  const steps = scan ? await listTraceSteps(scan.id, filter) : [];
  const selected = steps.find((s) => s.id === selectedId) ?? null;

  const running = scan?.status === "running" || scan?.status === "queued";

  function href(params: { f?: TraceFilter; paso?: string }): string {
    const q = new URLSearchParams();
    if (scan) q.set("scan", scan.id);
    const f = params.f ?? filter;
    if (f !== "todos") q.set("f", f);
    const paso = params.paso ?? selectedId;
    if (paso) q.set("paso", paso);
    const s = q.toString();
    return s ? `/traza?${s}` : "/traza";
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader zone={zone} quota={quota} />
      <TabBar counts={navCounts} lastScanLabel={null} />
      <LiveRefresh active={running} />

      {!scan ? (
        <div className="grid flex-1 place-items-center px-6">
          <p className="text-base2" style={{ color: "var(--muted)" }}>
            Todavía no hay ningún escaneo del que dejar traza.
          </p>
        </div>
      ) : (
        <>
          <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-panel px-4 py-2.5">
            <span className="font-mono text-2xs" style={{ color: "var(--dim)" }}>
              {scan.id.slice(0, 8)}
            </span>
            <span className="text-base2 font-medium">{scan.zoneName}</span>
            <span className="font-mono text-2xs" style={{ color: "var(--dim)" }}>
              {clock(scan.startedAt)}
            </span>
            <span
              className="rounded-[5px] px-1.5 py-0.5 text-2xs"
              style={{
                background: "var(--chip)",
                color: running ? "var(--accent)" : scan.totalErrors > 0 ? "var(--warn)" : "var(--ok)",
              }}
            >
              {scan.status}
            </span>

            <dl className="ml-auto flex items-baseline gap-4 font-mono text-2xs">
              {/*
               * Los cuatro totales salen de `scans`, que es lo que contó el
               * worker — no de las filas de la tabla. Cuando las dos cifras no
               * cuadran, esa diferencia es información y se avisa debajo.
               */}
              <div className="flex gap-1.5">
                <dt style={{ color: "var(--dim)" }}>pasos</dt>
                <dd className="tabular-nums">{scan.totalSteps}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt style={{ color: "var(--dim)" }}>tokens</dt>
                <dd className="tabular-nums">{scan.totalTokens.toLocaleString("es-ES")}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt style={{ color: "var(--dim)" }}>coste</dt>
                <dd className="tabular-nums">{moneyExact(scan.totalCostUsd)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt style={{ color: "var(--dim)" }}>errores</dt>
                <dd
                  className="tabular-nums"
                  style={{ color: scan.totalErrors > 0 ? "var(--crit)" : undefined }}
                >
                  {scan.totalErrors}
                </dd>
              </div>
            </dl>
          </header>

          <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-panel px-4 py-1.5">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={href({ f: f.value })}
                scroll={false}
                className={`flex h-6 items-center rounded-[7px] px-2 text-2xs whitespace-nowrap transition-colors ${
                  filter === f.value ? "bg-chip text-foreground" : "text-muted-foreground hover:bg-hover"
                }`}
              >
                {f.label}
              </Link>
            ))}
            <span className="ml-2 font-mono text-2xs" style={{ color: "var(--dim2)" }}>
              {running ? "se actualiza en vivo" : "escaneo terminado · no cambia"}
            </span>
          </div>

          {/*
           * El aviso que hace útil esta pantalla. El worker lleva contadores
           * propios en `scans` y además escribe una fila por paso. Cuando las
           * dos cifras no cuadran hay trabajo que ocurrió sin dejar rastro, y
           * eso es justo lo que uno viene a buscar aquí — así que se dice, en
           * vez de enseñar una tabla corta y aparentemente sana.
           *
           * No se afirma la causa: puede ser un paso que no se registró, o un
           * contador que suma algo que no es un paso. Lo comprobable es que no
           * cuadran, y eso es lo que dice.
           */}
          {filter === "todos" && steps.length < scan.totalSteps && (
            <div
              className="shrink-0 border-b border-line px-4 py-1.5 text-2xs"
              style={{ background: "var(--warn-soft)", color: "var(--warn2)" }}
            >
              Los contadores del escaneo y la traza no cuadran: cuenta {scan.totalSteps} pasos y
              aquí hay {steps.length}.
              {scan.totalErrors > 0 &&
                ` De los ${scan.totalErrors} errores contabilizados, ${
                  steps.filter((s) => s.status !== "ok").length
                } dejaron fila.`}{" "}
              Hubo trabajo que no quedó registrado como paso.
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-auto">
              <div
                className="sticky top-0 z-10 grid gap-2 border-b border-line bg-panel px-4 py-1.5 font-mono text-2xs"
                style={{ gridTemplateColumns: GRID, color: "var(--dim)" }}
              >
                <span>Hora</span>
                <span>Paso</span>
                <span>Objetivo</span>
                <span>Estado</span>
                <span className="text-right">Duración</span>
                <span className="text-right">Tokens</span>
                <span className="text-right">Coste</span>
              </div>

              {steps.length === 0 ? (
                <p className="px-4 py-6 text-sm2" style={{ color: "var(--muted)" }}>
                  Ningún paso con este filtro.
                </p>
              ) : (
                steps.map((s) => {
                  const isSelected = s.id === selectedId;
                  const tokens =
                    s.tokensIn !== null || s.tokensOut !== null
                      ? (s.tokensIn ?? 0) + (s.tokensOut ?? 0)
                      : null;

                  return (
                    <Link
                      key={s.id}
                      href={href({ paso: s.id })}
                      scroll={false}
                      className={`grid gap-2 border-b border-line-soft px-4 py-1.5 font-mono text-sm transition-colors ${
                        isSelected ? "bg-hover" : "hover:bg-hover"
                      }`}
                      style={{ gridTemplateColumns: GRID }}
                    >
                      <span style={{ color: "var(--dim)" }}>{clock(s.startedAt)}</span>
                      <span className="truncate">{s.step}</span>
                      <span className="truncate" style={{ color: "var(--muted)" }}>
                        {s.target}
                      </span>
                      <span style={{ color: statusColor(s.status) }}>{STATUS_LABEL[s.status]}</span>
                      <span className="text-right tabular-nums" style={{ color: "var(--dim)" }}>
                        {(s.durationMs / 1000).toFixed(2)} s
                      </span>
                      <span className="text-right tabular-nums" style={{ color: "var(--dim)" }}>
                        {tokens === null ? "—" : tokens.toLocaleString("es-ES")}
                      </span>
                      <span className="text-right tabular-nums" style={{ color: "var(--dim)" }}>
                        {s.costUsd > 0 ? moneyExact(s.costUsd) : "—"}
                      </span>
                    </Link>
                  );
                })
              )}
            </div>

            <StepDetail step={selected} />
          </div>
        </>
      )}
    </div>
  );
}
