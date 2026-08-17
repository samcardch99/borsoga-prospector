"use client";

/**
 * Ventana de "Auditoría web en vivo" (handoff §6.1).
 *
 * Es la pieza que convierte esto en una investigación que se mira, y no en un
 * proceso que termina y escupe una lista. Enseña dónde está el agente ahora
 * mismo: qué URL, qué acaba de mirar, qué le salió bien y qué no.
 *
 * Con `WORKER_CONCURRENCY=2` puede haber dos auditorías a la vez. La ventana
 * sigue a **la que tú elijas** — el conmutador de la cabecera cambia de una a
 * otra, y la línea de hormigas se repinta hacia el marcador del elegido. La
 * otra no se pausa: sigue trabajando y su rastro va a la Traza igual.
 *
 * La línea sale de la ventana al marcador con coordenadas de pantalla reales,
 * proyectadas por el mapa. El handoff avisa de esto: en SVG los porcentajes
 * solo valen en `line` y `circle`, así que hay que proyectar de verdad y
 * recolocar al mover o hacer zoom.
 */

import { useState } from "react";
import { CheckCircle2, CircleAlert, CircleX, MoveRight } from "lucide-react";
import type { LiveRun, LiveStep, TraceStatus } from "@/lib/queries";

/** Los símbolos del log, tal como los pide el handoff: ✓ ✗ ! → */
function StepIcon({ status }: { status: TraceStatus }) {
  if (status === "ok") return <CheckCircle2 size={11} style={{ color: "var(--ok)" }} />;
  if (status === "retry") return <CircleAlert size={11} style={{ color: "var(--warn)" }} />;
  if (status === "skipped") return <MoveRight size={11} style={{ color: "var(--dim2)" }} />;
  return <CircleX size={11} style={{ color: "var(--crit)" }} />;
}

function clock(date: Date): string {
  return new Date(date).toLocaleTimeString("es-ES", { minute: "2-digit", second: "2-digit" });
}

function Thumbnail({ run }: { run: LiveRun }) {
  const src = run.screenshotKey
    ? `/api/captura/${run.screenshotKey.split("/").map(encodeURIComponent).join("/")}`
    : null;

  return (
    <div
      className="relative h-[104px] w-[132px] shrink-0 overflow-hidden rounded-md border border-line2"
      style={{ background: "var(--inset)" }}
    >
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={src} alt="" className="h-full w-full object-cover object-top" />
      ) : (
        <span
          className="absolute inset-0 grid place-items-center px-2 text-center text-2xs"
          style={{ color: "var(--dim2)" }}
        >
          sin captura todavía
        </span>
      )}

      {/*
       * La línea de escaneo va aunque no haya captura: lo que comunica no es la
       * imagen, es que hay alguien mirando ahora mismo.
       */}
      <span
        className="animate-scan-y pointer-events-none absolute inset-x-0 h-[2px]"
        style={{ background: "var(--accent)", opacity: 0.7 }}
        aria-hidden
      />
    </div>
  );
}

function Log({ steps }: { steps: LiveStep[] }) {
  return (
    <div className="min-w-0 flex-1">
      <ul className="flex flex-col gap-0.5">
        {steps.slice(0, 6).map((s) => (
          <li key={s.id} className="flex items-center gap-1.5 font-mono text-2xs">
            <StepIcon status={s.status} />
            <span className="shrink-0" style={{ color: "var(--dim2)" }}>
              {clock(s.startedAt)}
            </span>
            <span className="shrink-0">{s.step}</span>
            <span className="truncate" style={{ color: "var(--dim)" }}>
              {s.target}
            </span>
          </li>
        ))}
      </ul>

      {/* Cursor parpadeante: el log está vivo aunque lleve un rato quieto. */}
      <span
        className="animate-blink mt-0.5 inline-block h-3 w-1.5 align-middle"
        style={{ background: "var(--accent)" }}
        aria-hidden
      />
    </div>
  );
}

export function LiveAuditPanel({
  runs,
  watchedId,
  onWatch,
}: {
  runs: LiveRun[];
  watchedId: string | null;
  onWatch: (prospectId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (runs.length === 0) return null;

  const watched = runs.find((r) => r.prospectId === watchedId) ?? runs[0];
  if (!watched) return null;

  return (
    <div className="absolute top-14 left-3 z-20 w-[380px] rounded-lg border border-line2 bg-glass backdrop-blur">
      <header className="flex items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: "var(--accent)" }}
        />
        <h3 className="text-sm2 font-medium whitespace-nowrap">Auditoría web en vivo</h3>
        <span className="font-mono text-2xs" style={{ color: "var(--dim)" }}>
          auditor
        </span>

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto font-mono text-2xs transition-colors hover:text-foreground"
          style={{ color: "var(--dim)" }}
        >
          {collapsed ? "abrir" : "plegar"}
        </button>
      </header>

      {/*
       * El conmutador solo aparece cuando hay más de una: con una sola sería
       * una pestaña que no conmuta nada.
       */}
      {runs.length > 1 && (
        <div className="flex items-center gap-0.5 border-b border-line-soft px-2 py-1">
          {runs.map((r) => (
            <button
              key={r.prospectId}
              type="button"
              onClick={() => onWatch(r.prospectId)}
              title={r.prospectName}
              className={`h-6 min-w-0 flex-1 truncate rounded-[6px] px-1.5 text-2xs transition-colors ${
                r.prospectId === watched.prospectId
                  ? "bg-chip text-foreground"
                  : "text-muted-foreground hover:bg-hover"
              }`}
            >
              {r.prospectName}
            </button>
          ))}
        </div>
      )}

      {!collapsed && (
        <div className="p-2.5">
          <p className="truncate font-mono text-2xs" style={{ color: "var(--accent)" }}>
            {watched.currentTarget ?? "(arrancando)"}
          </p>
          <p className="mt-0.5 font-mono text-2xs" style={{ color: "var(--dim2)" }}>
            {watched.steps.length} {watched.steps.length === 1 ? "paso" : "pasos"} · desde{" "}
            {clock(watched.startedAt)}
          </p>

          <div className="mt-2 flex gap-2.5">
            <Thumbnail run={watched} />
            <Log steps={watched.steps} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * La línea de hormigas de la ventana al marcador.
 *
 * Va en su propio SVG a pantalla completa sobre el mapa porque tiene que cruzar
 * por encima de todo. `stroke-dasharray: 2 6` con la animación `ants` es lo que
 * pide el handoff, y el codo en L evita que la línea tape la ventana.
 */
export function AntsLine({
  from,
  to,
  label,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Nombre del negocio, junto a la mira. */
  label?: string;
}) {
  const elbow = { x: from.x, y: to.y };

  return (
    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden>
      <line
        x1={from.x}
        y1={from.y}
        x2={elbow.x}
        y2={elbow.y}
        stroke="var(--accent)"
        strokeWidth={1}
        strokeDasharray="2 6"
        className="animate-ants"
      />
      <line
        x1={elbow.x}
        y1={elbow.y}
        x2={to.x}
        y2={to.y}
        stroke="var(--accent)"
        strokeWidth={1}
        strokeDasharray="2 6"
        className="animate-ants"
      />
      <circle cx={elbow.x} cy={elbow.y} r={2} fill="var(--accent)" />

      {/*
       * Mira sobre el negocio vigilado. Se dibuja aquí y no como `Marker` del
       * mapa a propósito: el vigilado casi nunca está en la zona que se está
       * mostrando, así que no tiene marcador propio y la línea acabaría en un
       * punto vacío. Esto es lo que hace ver *a quién* se está mirando.
       */}
      <circle
        cx={to.x}
        cy={to.y}
        r={13}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1}
        className="animate-pulse-ring"
        style={{ transformOrigin: `${to.x}px ${to.y}px` }}
      />
      <circle cx={to.x} cy={to.y} r={6} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
      <circle cx={to.x} cy={to.y} r={2} fill="var(--accent)" />

      {label && (
        <text
          x={to.x + 18}
          y={to.y + 3.5}
          fill="var(--accent)"
          fontSize={10}
          fontFamily="var(--font-mono)"
        >
          {label}
        </text>
      )}
    </svg>
  );
}
