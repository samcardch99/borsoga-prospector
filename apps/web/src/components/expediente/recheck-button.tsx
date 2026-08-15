"use client";

/**
 * "Reverificar con IA" del expediente.
 *
 * El handoff §8 pide que el estado se vea **en la propia fila** y no en un
 * spinner global: quien pide una reverificación sigue leyendo el resto del
 * expediente mientras tanto, y un velo sobre toda la pantalla lo impediría.
 */

import { useState, useTransition } from "react";
import { requestRecheck } from "@/app/revision/actions";

export function RecheckButton({ findingId }: { findingId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await requestRecheck(findingId);
      if (result.ok) setDone(true);
      else setError(result.error ?? "No se pudo encolar.");
    });
  }

  if (done) {
    return (
      <span className="text-sm2 whitespace-nowrap" style={{ color: "var(--muted)" }}>
        En cola. El worker lo recogerá cuando esté en marcha.
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="h-7 rounded-md border border-line2 px-2.5 text-sm2 whitespace-nowrap transition-colors hover:bg-hover disabled:opacity-45"
        style={{ color: "var(--muted)" }}
      >
        {pending ? "Encolando…" : "Reverificar con IA"}
      </button>
      {error && (
        <span className="text-2xs" style={{ color: "var(--crit)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
