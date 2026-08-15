/**
 * Zonas (handoff §6.7). Segunda mitad del paso 8.
 *
 * Tabla de zonas + formulario de 388 px. Es la pantalla que cierra el círculo:
 * hasta aquí solo se podía meter trabajo en la cola con el CLI del worker.
 */

import { COUNTY_LABEL, SECTOR_LABEL } from "@borsoga/shared";
import { getNavCounts, getQuota, getZone, listZones } from "@/lib/queries";
import { moneyExact, timeAgo } from "@/lib/display";
import { AppHeader } from "@/components/shell/app-header";
import { TabBar } from "@/components/shell/tab-bar";
import { ScanZoneButton, ZoneForm } from "@/components/zonas/zone-form";
import { ZoneToggle } from "@/components/zonas/zone-toggle";

export const dynamic = "force-dynamic";

export default async function ZonasPage() {
  const [rows, zone, quota, navCounts] = await Promise.all([
    listZones(),
    getZone(),
    getQuota(),
    getNavCounts(),
  ]);

  const now = new Date();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader zone={zone} quota={quota} />
      <TabBar counts={navCounts} lastScanLabel={null} />

      <main className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-base2">
            <thead>
              <tr className="border-b border-line text-left">
                {[
                  "Zona",
                  "Sectores",
                  "Programación",
                  "Último escaneo",
                  "Prospectos",
                  "Coste",
                  "",
                  "",
                ].map((h, i) => (
                  <th
                    key={`${h}-${i}`}
                    className="sticky top-0 bg-panel px-3 py-2 text-2xs font-medium tracking-wide uppercase"
                    style={{ color: "var(--dim)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6" style={{ color: "var(--muted)" }}>
                    No hay ninguna zona. Créala en el formulario de la derecha.
                  </td>
                </tr>
              ) : (
                rows.map((z) => (
                  <tr
                    key={z.id}
                    className="border-b border-line-soft"
                    style={z.active ? undefined : { opacity: 0.55 }}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{z.name}</div>
                      <div className="font-mono text-2xs" style={{ color: "var(--dim2)" }}>
                        {z.centerLat.toFixed(3)}, {z.centerLng.toFixed(3)} ·{" "}
                        {(z.radiusMeters / 1000).toFixed(1)} km · {COUNTY_LABEL[z.county]}
                      </div>
                    </td>
                    <td className="px-3 py-2.5" style={{ color: "var(--muted)" }}>
                      {z.sectors.map((s) => SECTOR_LABEL[s]).join(", ") || "todos"}
                    </td>
                    <td
                      className="px-3 py-2.5 font-mono text-2xs"
                      style={{ color: z.schedule ? "var(--text2)" : "var(--dim2)" }}
                    >
                      {z.schedule ?? "solo manual"}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-2xs" style={{ color: "var(--dim)" }}>
                      {z.lastScanAt ? timeAgo(z.lastScanAt, now) : "nunca"}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums">{z.prospectCount}</td>
                    <td className="px-3 py-2.5 font-mono text-2xs tabular-nums">
                      {z.lastScanCostUsd === null ? "—" : moneyExact(z.lastScanCostUsd)}
                    </td>
                    <td className="px-3 py-2.5">
                      <ScanZoneButton zoneId={z.id} />
                    </td>
                    <td className="px-3 py-2.5">
                      <ZoneToggle zoneId={z.id} active={z.active} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <p className="px-3 py-3 text-2xs" style={{ color: "var(--dim2)" }}>
            Las zonas con programación cron todavía no se disparan solas: hace falta un
            planificador que encole `scan.zone` a su hora. Escanear a mano sí funciona.
          </p>
        </div>

        <ZoneForm />
      </main>
    </div>
  );
}
