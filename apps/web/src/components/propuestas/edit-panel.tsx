"use client";

/**
 * Panel en modo "Editar" (handoff §6.4).
 *
 * La regla que gobierna esta pantalla está escrita en el propio panel, y no es
 * un adorno: la IA solo reescribe los bloques de texto IA. Los hallazgos y los
 * precios nunca. Son la parte que hay que poder defender con la evidencia
 * delante, y un modelo reescribiéndolos convertiría la propuesta en literatura.
 *
 * El arrastre reordena de forma optimista y persiste después. Si la escritura
 * falla, el orden vuelve al que había — mejor eso que dejar la lista diciendo
 * una cosa y la base otra.
 */

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { GripVertical, Plus, Sparkles, Trash2 } from "lucide-react";
import type { BlockType, LoadedProposal, ProposalBlock } from "@/lib/proposals";
import {
  addBlock,
  deleteBlock,
  reorderBlocks,
  requestRewrite,
  setTone,
  toggleBlock,
} from "@/app/propuestas/actions";

const TYPE_LABEL: Record<BlockType, string> = {
  fixed: "fijo",
  text: "texto",
  ai_text: "texto IA",
  findings: "hallazgos",
  pricing: "precios",
};

const TONES: Array<{ value: string; label: string }> = [
  { value: "direct", label: "Directo" },
  { value: "close", label: "Cercano" },
  { value: "technical", label: "Técnico" },
];

export function EditPanel({
  proposal,
  selectedBlockId,
  hrefFor,
}: {
  proposal: LoadedProposal;
  selectedBlockId: string | null;
  /** Construido en el servidor para no repetir aquí el armado de la URL. */
  hrefFor: { configurar: string; blockPrefix: string };
}) {
  /*
   * `useOptimistic` y no una copia en `useState`: el orden real lo manda el
   * servidor, y esto solo lo adelanta mientras la escritura viaja. Con una
   * copia propia habría que sincronizarla a mano cuando las props cambian por
   * fuera, y ese "sincronizar a mano" es justamente lo que se hace mal.
   */
  const [order, setOrder] = useOptimistic<ProposalBlock[]>(proposal.blocks);
  const [dragging, setDragging] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onDrop(targetId: string) {
    if (!dragging || dragging === targetId) return setDragging(null);

    const from = order.findIndex((b) => b.id === dragging);
    const to = order.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return setDragging(null);

    const next = [...order];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);

    setDragging(null);

    startTransition(async () => {
      setOrder(next);
      const result = await reorderBlocks(
        proposal.id,
        next.map((b) => b.id),
      );
      // Si falla, el optimista se descarta solo al llegar las props reales.
      if (!result.ok) setError("No se pudo guardar el orden.");
    });
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okNote?: string) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "No se pudo guardar.");
      else if (okNote) setNote(okNote);
    });
  }

  return (
    <aside className="flex w-[396px] shrink-0 flex-col border-r border-line bg-panel print:hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <Link
          href={hrefFor.configurar}
          className="rounded-[6px] px-1.5 py-0.5 text-2xs transition-colors hover:bg-hover"
          style={{ color: "var(--muted)" }}
        >
          Configurar
        </Link>
        <h2 className="rounded-[6px] bg-chip px-1.5 py-0.5 text-base2 font-medium">Editar</h2>
        <span className="ml-auto font-mono text-2xs" style={{ color: "var(--dim2)" }}>
          {pending ? "guardando…" : "guardado"}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-1">
          {order.map((block) => {
            const selected = block.id === selectedBlockId;

            return (
              <li
                key={block.id}
                draggable
                onDragStart={() => setDragging(block.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(block.id)}
                onDragEnd={() => setDragging(null)}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors ${
                  selected ? "border-transparent bg-chip" : "border-line hover:bg-hover"
                }`}
                style={{ opacity: dragging === block.id ? 0.4 : block.enabled ? 1 : 0.5 }}
              >
                <GripVertical
                  size={13}
                  className="shrink-0 cursor-grab"
                  style={{ color: "var(--dim3)" }}
                  aria-hidden
                />

                <button
                  type="button"
                  onClick={() => run(() => toggleBlock(proposal.id, block.id, !block.enabled))}
                  aria-label={block.enabled ? `Desactivar ${block.name}` : `Activar ${block.name}`}
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: block.enabled ? "var(--accent)" : "var(--line3)" }}
                />

                <Link
                  href={`${hrefFor.blockPrefix}${block.id}`}
                  scroll={false}
                  className="min-w-0 flex-1 truncate text-base2"
                >
                  {block.name}
                </Link>

                <span className="shrink-0 font-mono text-2xs" style={{ color: "var(--dim2)" }}>
                  {TYPE_LABEL[block.type]}
                </span>

                {block.type !== "fixed" &&
                  block.type !== "findings" &&
                  block.type !== "pricing" && (
                    <button
                      type="button"
                      onClick={() => run(() => deleteBlock(proposal.id, block.id))}
                      aria-label={`Borrar ${block.name}`}
                      className="shrink-0 transition-colors hover:text-[var(--crit)]"
                      style={{ color: "var(--dim3)" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
              </li>
            );
          })}
        </ul>

        {adding ? (
          <div className="mt-2 rounded-lg border border-line p-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre del bloque"
              className="h-7 w-full rounded-md border border-line2 bg-field px-2 text-base2"
            />
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={() =>
                  run(() => addBlock(proposal.id, "text", newName), "Bloque añadido.")
                }
                className="h-7 flex-1 rounded-md border border-line2 text-2xs"
              >
                Texto
              </button>
              <button
                type="button"
                onClick={() =>
                  run(() => addBlock(proposal.id, "ai_text", newName), "Bloque añadido.")
                }
                className="h-7 flex-1 rounded-md border border-line2 text-2xs"
              >
                Texto IA
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="h-7 rounded-md px-2 text-2xs"
                style={{ color: "var(--muted)" }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 flex h-7 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-line2 text-2xs transition-colors hover:bg-hover"
            style={{ color: "var(--muted)" }}
          >
            <Plus size={12} /> Añadir bloque
          </button>
        )}

        <section className="mt-4">
          <h3 className="text-sm2 font-medium">Tono</h3>
          <div className="mt-1.5 flex items-center gap-0.5 rounded-lg border border-line2 bg-field p-0.5">
            {TONES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => run(() => setTone(proposal.id, t.value))}
                className={`h-6 flex-1 rounded-[6px] text-2xs transition-colors ${
                  proposal.tone === t.value
                    ? "bg-chip text-foreground"
                    : "text-muted-foreground hover:bg-hover"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-2xs" style={{ color: "var(--dim2)" }}>
            La IA solo reescribe los bloques de <strong>texto IA</strong>. Los hallazgos y los
            precios no pasan por el modelo: son lo que hay que poder defender con la evidencia
            delante.
          </p>
        </section>

        {error && (
          <p
            className="mt-3 border-l-2 pl-2 text-sm2"
            style={{ borderColor: "var(--crit)", color: "var(--crit)" }}
          >
            {error}
          </p>
        )}
        {note && (
          <p className="mt-3 text-sm2" style={{ color: "var(--ok)" }}>
            {note}
          </p>
        )}
      </div>

      <footer className="shrink-0 border-t border-line p-3">
        <button
          type="button"
          onClick={() =>
            run(
              () => requestRewrite(proposal.id),
              "En cola. El worker reescribirá los bloques de texto IA cuando esté en marcha.",
            )
          }
          disabled={pending}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border text-base whitespace-nowrap transition-colors disabled:opacity-45"
          style={{ borderColor: "var(--accent-line)", color: "var(--accent)" }}
        >
          <Sparkles size={13} /> Reescribir con IA
        </button>
      </footer>
    </aside>
  );
}
