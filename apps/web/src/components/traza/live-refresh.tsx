"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * "Se actualiza en vivo" (handoff §6.6), por sondeo cada 2,5 s.
 *
 * Solo mientras el escaneo corre. Un sondeo perpetuo sobre un escaneo terminado
 * es una consulta a Postgres cada dos segundos y medio para siempre, y la traza
 * de algo acabado no cambia nunca más.
 *
 * `router.refresh()` en vez de un `fetch` propio: revalida los Server
 * Components de la ruta y la tabla se repinta con los pasos nuevos sin que haya
 * que duplicar en el cliente ni las consultas ni el formato de las filas.
 */
export function LiveRefresh({ active, intervalMs = 2500 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  return null;
}
