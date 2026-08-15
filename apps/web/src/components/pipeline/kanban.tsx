"use client";

/**
 * El kanban del pipeline (handoff §6.5).
 *
 * Seis columnas de 246 px con scroll horizontal. El movimiento entre etapas va
 * por un selector en cada tarjeta y no por arrastrar: el handoff describe el
 * arrastre para los bloques de la propuesta, no para esto, y un `select` es lo
 * único que funciona igual con teclado, con ratón y en una pantalla estrecha.
 */

import { useTransition } from "react";
import Link from "next/link";
import { SECTOR_LABEL } from "@borsoga/shared";
import { money, scoreColor, timeAgo } from "@/lib/display";
import type { PipelineCard, PipelineStage } from "@/lib/queries";
import { moveToStage } from "@/app/pipeline/actions";

const COLUMNS: Array<{ stage: PipelineStage; label: string; color: string }> = [
  { stage: "detected", label: "Detectado", color: "var(--dim)" },
  { stage: "reviewed", label: "Revisado", color: "var(--b1)" },
  { stage: "proposal_sent", label: "Propuesta enviada", color: "var(--accent)" },
  { stage: "meeting", label: "Reunión", color: "var(--b3)" },
  { stage: "won", label: "Ganado", color: "var(--ok)" },
  { stage: "lost", label: "Perdido", color: "var(--crit)" },
];

function Card({ card, now }: { card: PipelineCard; now: Date }) {
  const [pending, startTransition] = useTransition();

  function onChange(stage: PipelineStage) {
    startTransition(async () => {
      await moveToStage(card.id, stage);
    });
  }

  return (
    <article
      className="rounded-xl border border-line bg-card p-2.5"
      style={pending ? { opacity: 0.5 } : undefined}
    >
      <div className="flex items-start gap-2">
        <Link
          href={`/expediente/${card.id}`}
          className="min-w-0 flex-1 truncate text-base2 font-medium"
        >
          {card.name}
        </Link>
        <span
          className="shrink-0 font-mono text-sm2 font-medium"
          style={{ color: scoreColor(card.score) }}
        >
          {card.score}
        </span>
      </div>

      <p className="truncate text-2xs" style={{ color: "var(--muted)" }}>
        {card.sectors.map((s) => SECTOR_LABEL[s]).join(" · ") || "Sector sin clasificar"} ·{" "}
        {card.city}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <span className="font-mono text-2xs" style={{ color: "var(--dim2)" }}>
          {timeAgo(card.lastActivityAt ?? card.firstSeenAt, now)}
        </span>
        <span className="ml-auto font-mono text-2xs" style={{ color: "var(--dim)" }}>
          {money(card.ticketEstimate)}
        </span>
      </div>

      <select
        value={card.stage}
        onChange={(e) => onChange(e.target.value as PipelineStage)}
        disabled={pending}
        aria-label={`Etapa de ${card.name}`}
        className="mt-2 h-7 w-full rounded-md border border-line2 bg-field px-1.5 text-2xs"
      >
        {COLUMNS.map((c) => (
          <option key={c.stage} value={c.stage}>
            {c.label}
          </option>
        ))}
      </select>
    </article>
  );
}

export function Kanban({ cards, now }: { cards: PipelineCard[]; now: Date }) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
      {COLUMNS.map((column) => {
        const inColumn = cards.filter((c) => c.stage === column.stage);
        const value = inColumn.reduce((sum, c) => sum + c.ticketEstimate, 0);

        return (
          <section key={column.stage} className="flex w-[246px] shrink-0 flex-col">
            <header className="flex items-baseline gap-1.5 border-b border-line pb-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: column.color }}
                aria-hidden
              />
              <h2 className="text-base2 font-medium whitespace-nowrap">{column.label}</h2>
              <span className="font-mono text-2xs" style={{ color: "var(--dim)" }}>
                {inColumn.length}
              </span>
              <span className="ml-auto font-mono text-2xs" style={{ color: "var(--dim2)" }}>
                {money(value)}
              </span>
            </header>

            <div className="mt-2 flex flex-col gap-2">
              {inColumn.map((card) => (
                <Card key={card.id} card={card} now={now} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
