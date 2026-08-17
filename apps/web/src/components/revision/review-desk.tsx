"use client";

/**
 * La mesa de revisión (handoff §6.3): un hallazgo a la vez, con la cola a la
 * derecha.
 *
 * Dos decisiones que definen cómo se siente:
 *
 * 1. **Se guarda y salta al siguiente.** Revisar veintitrés hallazgos es una
 *    tarea de ritmo; obligar a volver a la lista después de cada uno la
 *    convierte en veintitrés tareas. El avance es local y optimista, así que no
 *    hay parpadeo entre uno y otro.
 *
 * 2. **Los atajos funcionan sin foco en ningún control**, como pide el handoff
 *    §8. El listener va en `window`, y se desactiva mientras se escribe una nota
 *    — si no, teclear "casa" en el matiz confirmaría, descartaría y saltaría dos
 *    hallazgos.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { BRANCH_META } from "@borsoga/shared";
import {
  EVIDENCE_LAYER_LABEL,
  SEVERITY_LABEL,
  branchColor,
  severityColor,
} from "@/lib/display";
import type { ReviewFilter, ReviewItem } from "@/lib/queries";
import { requestRecheck, setVerdict } from "@/app/revision/actions";

const FILTERS: Array<{ value: ReviewFilter; label: string }> = [
  { value: "pendientes", label: "Pendientes" },
  { value: "matizados", label: "Matizados" },
  { value: "todos", label: "Todos" },
];

function formatDate(date: Date): string {
  return new Date(date).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Shortcut({ keyName, label }: { keyName: string; label: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <kbd
        className="rounded-[4px] border border-line2 px-1 font-mono text-2xs"
        style={{ background: "var(--inset)", color: "var(--text2)" }}
      >
        {keyName}
      </kbd>
      <span className="text-2xs" style={{ color: "var(--dim)" }}>
        {label}
      </span>
    </span>
  );
}

export function ReviewDesk({
  items,
  filter,
  reviewedToday,
}: {
  items: ReviewItem[];
  filter: ReviewFilter;
  reviewedToday: number;
}) {
  const [index, setIndex] = useState(0);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const current = items[index];
  const total = items.length;

  const advance = useCallback(() => {
    setNoteOpen(false);
    setNote("");
    setError(null);
    setIndex((i) => Math.min(i + 1, Math.max(total - 1, 0)));
  }, [total]);

  const run = useCallback(
    (action: () => Promise<{ ok: boolean; error?: string }>, id: string) => {
      startTransition(async () => {
        const result = await action();
        if (!result.ok) {
          setError(result.error ?? "No se pudo guardar.");
          return;
        }
        setResolved((prev) => new Set(prev).add(id));
        advance();
      });
    },
    [advance],
  );

  const confirm = useCallback(() => {
    if (!current) return;
    run(() => setVerdict(current.id, "confirmed"), current.id);
  }, [current, run]);

  const discard = useCallback(() => {
    if (!current) return;
    run(() => setVerdict(current.id, "discarded"), current.id);
  }, [current, run]);

  const recheck = useCallback(() => {
    if (!current) return;
    run(() => requestRecheck(current.id), current.id);
  }, [current, run]);

  const submitNote = useCallback(() => {
    if (!current) return;
    run(() => setVerdict(current.id, "nuanced", note), current.id);
  }, [current, note, run]);

  /* Atajos globales. Ver la nota de arriba sobre por qué se desactivan al
     escribir: `isTyping` cubre también un futuro campo de búsqueda. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case "c":
          event.preventDefault();
          confirm();
          break;
        case "m":
          event.preventDefault();
          setNoteOpen(true);
          // El foco va al textarea en el siguiente frame, cuando ya existe.
          requestAnimationFrame(() => noteRef.current?.focus());
          break;
        case "d":
          event.preventDefault();
          discard();
          break;
        case "arrowdown":
          event.preventDefault();
          setIndex((i) => Math.min(i + 1, Math.max(total - 1, 0)));
          break;
        case "arrowup":
          event.preventDefault();
          setIndex((i) => Math.max(i - 1, 0));
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, discard, total]);

  const prospectCount = new Set(items.map((i) => i.prospectId)).size;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
        <h1 className="text-md2 font-medium whitespace-nowrap">Revisión</h1>
        <span className="font-mono text-xs2 whitespace-nowrap" style={{ color: "var(--dim)" }}>
          {total} {total === 1 ? "hallazgo" : "hallazgos"} · {prospectCount}{" "}
          {prospectCount === 1 ? "prospecto" : "prospectos"}
        </span>

        <div className="ml-3 flex items-center gap-0.5 rounded-lg border border-line2 bg-field p-0.5">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/revision?f=${f.value}`}
              className={`flex h-6 items-center rounded-[6px] px-2 text-2xs whitespace-nowrap transition-colors ${
                filter === f.value ? "bg-chip text-foreground" : "text-muted-foreground hover:bg-hover"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <Shortcut keyName="C" label="confirmar" />
          <Shortcut keyName="M" label="matizar" />
          <Shortcut keyName="D" label="descartar" />
          <Shortcut keyName="↑↓" label="navegar" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          {!current ? (
            <p className="text-base2" style={{ color: "var(--muted)" }}>
              No queda nada por revisar con este filtro.
            </p>
          ) : (
            <div className="mx-auto max-w-[980px]">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/expediente/${current.prospectId}#hallazgo-${current.id}`}
                  className="text-base2 font-medium"
                  style={{ color: "var(--accent)" }}
                >
                  {current.prospectName}
                </Link>
                <span className="text-2xs" style={{ color: "var(--dim)" }}>
                  {current.prospectCity}
                </span>
                <span
                  className="rounded-[5px] px-1.5 py-0.5 text-2xs"
                  style={{ background: "var(--chip)", color: branchColor(current.branch) }}
                >
                  {BRANCH_META[current.branch].label}
                </span>
                <span
                  className="rounded-[5px] px-1.5 py-0.5 text-2xs"
                  style={{ background: "var(--inset)", color: severityColor(current.severity) }}
                >
                  {SEVERITY_LABEL[current.severity]}
                </span>
                <span className="ml-auto font-mono text-2xs" style={{ color: "var(--dim2)" }}>
                  hallazgo {index + 1} de {total}
                </span>
              </div>

              <h2 className="mt-2 text-4xl leading-tight font-bold">{current.title}</h2>
              <p
                className="mt-2 max-w-[760px] text-base2"
                style={{ color: "var(--muted)", lineHeight: 1.55 }}
              >
                {current.description}
              </p>

              {/* Dos tarjetas al 50 %: la cita servida y la captura. */}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <section className="rounded-xl border border-line bg-card p-3">
                  <header className="flex items-baseline gap-2">
                    <span
                      className="text-2xs font-medium tracking-wide uppercase"
                      style={{ color: "var(--dim)" }}
                    >
                      Evidencia
                    </span>
                    <span
                      className="rounded-[5px] px-1.5 py-0.5 text-2xs"
                      style={{
                        background:
                          current.evidence.layer === "mismatch" ? "var(--warn-soft)" : "var(--chip)",
                        color:
                          current.evidence.layer === "mismatch" ? "var(--warn2)" : "var(--muted)",
                      }}
                    >
                      {EVIDENCE_LAYER_LABEL[current.evidence.layer] ?? current.evidence.layer}
                    </span>
                  </header>
                  <a
                    href={current.evidence.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate font-mono text-2xs"
                    style={{ color: "var(--accent)" }}
                  >
                    {current.evidence.url}
                  </a>
                  <pre
                    className="mt-2 max-h-[260px] overflow-auto rounded-lg p-2.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap"
                    style={{ background: "var(--inset)", color: "var(--text2)" }}
                  >
                    {current.evidence.quote}
                  </pre>
                  <p className="mt-1.5 font-mono text-2xs" style={{ color: "var(--dim2)" }}>
                    {formatDate(current.evidence.capturedAt)} · {current.evidence.method}
                  </p>
                </section>

                <section className="grid place-items-center rounded-xl border border-line bg-card p-3">
                  {current.evidence.screenshotStorageKey ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/captura/${current.evidence.screenshotStorageKey
                        .split("/")
                        .map(encodeURIComponent)
                        .join("/")}`}
                      alt={`Captura de ${current.evidence.url}`}
                      className="max-h-[300px] w-auto rounded-lg border border-line2"
                    />
                  ) : (
                    <p className="text-center text-2xs" style={{ color: "var(--dim2)" }}>
                      Sin captura: esta evidencia se tomó del DOM, no de una imagen
                    </p>
                  )}
                </section>
              </div>

              <div
                className="mt-4 max-w-[760px] border-l-2 pl-3"
                style={{ borderColor: branchColor(current.branch) }}
              >
                <h3
                  className="text-2xs font-medium tracking-wide uppercase"
                  style={{ color: "var(--dim)" }}
                >
                  Lo que gana el cliente
                </h3>
                <p className="mt-1 text-base2" style={{ color: "var(--text2)", lineHeight: 1.55 }}>
                  {current.clientGain}
                </p>
              </div>

              {noteOpen && (
                <div className="mt-4 max-w-[760px]">
                  <label
                    htmlFor="nota"
                    className="text-2xs font-medium tracking-wide uppercase"
                    style={{ color: "var(--dim)" }}
                  >
                    En qué se matiza
                  </label>
                  <textarea
                    id="nota"
                    ref={noteRef}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="Qué parte del hallazgo se sostiene y cuál no."
                    className="mt-1 w-full rounded-lg border border-line2 bg-field p-2.5 text-base2"
                  />
                </div>
              )}

              {error && (
                <p
                  className="mt-3 max-w-[760px] border-l-2 pl-2 text-base2"
                  style={{ borderColor: "var(--crit)", color: "var(--crit)" }}
                >
                  {error}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {noteOpen ? (
                  <>
                    <button
                      type="button"
                      onClick={submitNote}
                      disabled={pending}
                      className="h-8 rounded-md px-3 text-base whitespace-nowrap disabled:opacity-45"
                      style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
                    >
                      Guardar matiz
                    </button>
                    <button
                      type="button"
                      onClick={() => setNoteOpen(false)}
                      className="h-8 rounded-md border border-line2 px-3 text-base whitespace-nowrap"
                      style={{ color: "var(--muted)" }}
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={confirm}
                      disabled={pending}
                      className="h-8 rounded-md px-3 text-base whitespace-nowrap disabled:opacity-45"
                      style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNoteOpen(true);
                        requestAnimationFrame(() => noteRef.current?.focus());
                      }}
                      disabled={pending}
                      className="h-8 rounded-md border border-line2 px-3 text-base whitespace-nowrap disabled:opacity-45"
                      style={{ color: "var(--text2)" }}
                    >
                      Matizar y editar
                    </button>
                    <button
                      type="button"
                      onClick={discard}
                      disabled={pending}
                      className="h-8 rounded-md border border-line2 px-3 text-base whitespace-nowrap disabled:opacity-45"
                      style={{ color: "var(--muted)" }}
                    >
                      Descartar
                    </button>
                    <button
                      type="button"
                      onClick={recheck}
                      disabled={pending}
                      className="h-8 rounded-md border border-line2 px-3 text-base whitespace-nowrap disabled:opacity-45"
                      style={{ color: "var(--muted)" }}
                    >
                      Reverificar con IA
                    </button>
                  </>
                )}

                <span className="text-2xs" style={{ color: "var(--dim2)" }}>
                  {pending ? "guardando…" : "se guarda y salta al siguiente"}
                </span>
              </div>
            </div>
          )}
        </main>

        <aside className="flex w-[328px] shrink-0 flex-col border-l border-line bg-panel">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setIndex(i)}
                className={`flex w-full gap-2 border-b border-line-soft px-3 py-2.5 text-left transition-colors ${
                  i === index ? "bg-chip" : "hover:bg-hover"
                }`}
                style={resolved.has(item.id) ? { opacity: 0.45 } : undefined}
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: severityColor(item.severity) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-2xs" style={{ color: "var(--dim)" }}>
                      {item.prospectName}
                    </span>
                    <span
                      className="font-mono text-2xs font-medium"
                      style={{ color: branchColor(item.branch) }}
                    >
                      {BRANCH_META[item.branch].letter}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-sm2 leading-snug">
                    {item.title}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <footer className="shrink-0 border-t border-line px-3 py-2 text-xs2">
            <span style={{ color: "var(--dim)" }}>Revisados hoy </span>
            <span className="font-mono" style={{ color: "var(--text2)" }}>
              {reviewedToday + resolved.size}
            </span>
          </footer>
        </aside>
      </div>
    </div>
  );
}
