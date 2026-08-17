"use client";

import { useTransition } from "react";
import { toggleZone } from "@/app/zonas/actions";

/**
 * El interruptor de la última columna. Una zona inactiva no se escanea ni por
 * programación ni a mano, y por eso su fila baja al 55 % — el estado tiene que
 * verse desde el otro lado de la mesa.
 */
export function ZoneToggle({ zoneId, active }: { zoneId: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? "Desactivar zona" : "Activar zona"}
      disabled={pending}
      onClick={() => startTransition(async () => void (await toggleZone(zoneId)))}
      className="relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-45"
      style={{ background: active ? "var(--accent)" : "var(--line3)" }}
    >
      <span
        className="absolute top-0.5 h-3 w-3 rounded-full transition-all"
        style={{ left: active ? 14 : 2, background: "var(--panel)" }}
      />
    </button>
  );
}
