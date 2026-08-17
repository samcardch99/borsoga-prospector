/**
 * La tarjeta de evidencia (handoff §6.2, columna derecha de cada hallazgo).
 *
 * Es el corazón de la herramienta. La regla del proyecto es "sin evidencia no
 * hay hallazgo", y esta tarjeta es donde esa regla se puede comprobar a simple
 * vista: la URL exacta, la cita textual sin retocar, la capa donde se vio, el
 * método y la fecha. Si algo de eso falta, el hallazgo no se puede defender
 * delante de un cliente.
 *
 * Por eso la cita va en mono con `whitespace-pre-wrap` y no se recorta con
 * puntos suspensivos: un volcado reformateado ya no es una cita.
 */

import { EVIDENCE_LAYER_LABEL } from "@/lib/display";
import type { FullEvidence } from "@/lib/queries";

function formatDate(date: Date): string {
  return date.toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Screenshot({ evidence }: { evidence: FullEvidence }) {
  if (!evidence.screenshotStorageKey) {
    /*
     * Hueco explícito y no ausencia silenciosa. Una evidencia sin captura es
     * perfectamente válida —la cita textual es lo obligatorio— pero quien
     * revisa tiene que poder distinguir "no se capturó" de "no se ha cargado".
     */
    return (
      <div
        className="grid w-[178px] shrink-0 place-items-center rounded-lg border border-dashed p-3 text-center"
        style={{ borderColor: "var(--line2)", minHeight: 120 }}
      >
        <span className="text-2xs" style={{ color: "var(--dim2)" }}>
          Sin captura: esta evidencia se tomó del DOM, no de una imagen
        </span>
      </div>
    );
  }

  const src = `/api/captura/${evidence.screenshotStorageKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  return (
    <figure className="w-[178px] shrink-0">
      <a href={src} target="_blank" rel="noreferrer" className="block">
        {/*
         * `img` y no `next/image`: la fuente es una ruta de API con tamaño
         * desconocido en build y el optimizador no aporta nada sobre una
         * captura que se sirve una vez y se cachea de forma inmutable.
         */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`Captura de ${evidence.url}`}
          width={evidence.screenshotWidth ?? 178}
          height={evidence.screenshotHeight ?? 120}
          className="w-full rounded-lg border border-line2"
        />
      </a>
      <figcaption className="mt-1 font-mono text-2xs" style={{ color: "var(--dim2)" }}>
        {evidence.screenshotTakenAt ? formatDate(evidence.screenshotTakenAt) : "—"}
        {evidence.screenshotWidth ? ` · ${evidence.screenshotWidth}px` : ""}
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="ml-1"
          style={{ color: "var(--accent)" }}
        >
          ver completa
        </a>
      </figcaption>
    </figure>
  );
}

export function EvidenceCard({ evidence }: { evidence: FullEvidence }) {
  return (
    <aside className="rounded-xl border border-line bg-card p-3">
      <header className="flex items-baseline gap-2">
        <span className="text-2xs font-medium tracking-wide uppercase" style={{ color: "var(--dim)" }}>
          Evidencia
        </span>
        <span
          className="rounded-[5px] px-1.5 py-0.5 text-2xs whitespace-nowrap"
          style={{
            background: evidence.layer === "mismatch" ? "var(--warn-soft)" : "var(--chip)",
            color: evidence.layer === "mismatch" ? "var(--warn2)" : "var(--muted)",
          }}
        >
          {EVIDENCE_LAYER_LABEL[evidence.layer] ?? evidence.layer}
        </span>
      </header>

      <a
        href={evidence.url}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block truncate font-mono text-2xs"
        style={{ color: "var(--accent)" }}
      >
        {evidence.url}
      </a>

      <div className="mt-2 flex gap-3">
        <div className="min-w-0 flex-1">
          <pre
            className="max-h-[220px] overflow-auto rounded-lg p-2.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap"
            style={{ background: "var(--inset)", color: "var(--text2)" }}
          >
            {evidence.quote}
          </pre>
          <p className="mt-1.5 font-mono text-2xs" style={{ color: "var(--dim2)" }}>
            {formatDate(evidence.capturedAt)} · {evidence.method}
          </p>
        </div>

        <Screenshot evidence={evidence} />
      </div>
    </aside>
  );
}
