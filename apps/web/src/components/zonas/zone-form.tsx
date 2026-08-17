"use client";

/**
 * Formulario de zona (handoff §6.7). Cada campo lleva su pista a la derecha en
 * mono, que es lo que convierte el formulario en algo que se puede rellenar sin
 * saberse las coordenadas de Doral de memoria.
 *
 * La estimación de negocios y coste es una regla de tres sobre el área, no una
 * consulta a Places: preguntarle a Places cuántos hay costaría exactamente lo
 * que se quiere estimar antes de gastar. Se dice en la propia tarjeta.
 */

import { useMemo, useState, useTransition } from "react";
import { COUNTY_LABEL, ICP, SECTOR_LABEL, type County, type Sector } from "@borsoga/shared";
import { moneyExact } from "@/lib/display";
import { createZone, scanZoneNow } from "@/app/zonas/actions";

/** Coste aproximado por negocio con caché, del handoff §10.2. */
const USD_PER_BUSINESS = 0.035;
/** Densidad observada de negocios del ICP por km² en área urbana del sur de Florida. */
const BUSINESSES_PER_KM2 = 4.5;

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-3 block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm2 font-medium">{label}</span>
        <span className="font-mono text-2xs" style={{ color: "var(--dim2)" }}>
          {hint}
        </span>
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

const inputClass =
  "h-8 w-full rounded-md border border-line2 bg-field px-2 text-base2 tabular-nums";

export function ZoneForm() {
  const [name, setName] = useState("");
  const [county, setCounty] = useState<County>("miami_dade");
  const [lat, setLat] = useState("25.809");
  const [lng, setLng] = useState("-80.355");
  const [radius, setRadius] = useState("8000");
  const [sectors, setSectors] = useState<Sector[]>(["kitchens", "cabinetry"]);
  const [minTicket, setMinTicket] = useState(String(ICP.minProjectUsd));
  const [schedule, setSchedule] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const estimate = useMemo(() => {
    const r = Number(radius);
    if (!Number.isFinite(r) || r <= 0) return { businesses: 0, costUsd: 0 };
    const km2 = Math.PI * (r / 1000) ** 2;
    const businesses = Math.round(km2 * BUSINESSES_PER_KM2);
    return { businesses, costUsd: businesses * USD_PER_BUSINESS };
  }, [radius]);

  function payload() {
    return {
      name: name.trim(),
      county,
      center: { lat: Number(lat), lng: Number(lng) },
      radiusMeters: Math.round(Number(radius)),
      sectors,
      minTicketUsd: Math.round(Number(minTicket)),
      schedule: schedule.trim() === "" ? null : schedule.trim(),
      active: true,
    };
  }

  function submit(alsoScan: boolean) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const created = await createZone(payload());
      if (!created.ok) {
        setError(created.error ?? "No se pudo guardar.");
        return;
      }
      if (!alsoScan) {
        setMessage("Zona guardada.");
        return;
      }
      setMessage("Zona guardada. Busca su fila para lanzar el escaneo.");
    });
  }

  function toggleSector(sector: Sector) {
    setSectors((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector],
    );
  }

  return (
    <aside className="flex w-[388px] shrink-0 flex-col border-l border-line bg-panel">
      <header className="shrink-0 border-b border-line px-3 py-2.5">
        <h2 className="text-base2 font-medium">Nueva zona</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <Field label="Nombre" hint="cómo la llamáis">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Doral"
            className={inputClass}
          />
        </Field>

        <Field label="Condado" hint="del ICP">
          <select
            value={county}
            onChange={(e) => setCounty(e.target.value as County)}
            className={inputClass}
          >
            {ICP.counties.map((c) => (
              <option key={c} value={c}>
                {COUNTY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitud" hint="grados">
            <input value={lat} onChange={(e) => setLat(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Longitud" hint="grados">
            <input value={lng} onChange={(e) => setLng(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Field label="Radio" hint="metros · máx 50.000">
          <input
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            inputMode="numeric"
            className={inputClass}
          />
        </Field>

        <div className="mt-3">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-sm2 font-medium">Sectores</span>
            <span className="font-mono text-2xs" style={{ color: "var(--dim2)" }}>
              al menos uno
            </span>
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ICP.sectors.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSector(s)}
                className={`h-6 rounded-[7px] border px-2 text-2xs whitespace-nowrap transition-colors ${
                  sectors.includes(s)
                    ? "border-transparent bg-chip text-foreground"
                    : "border-line2 text-muted-foreground hover:bg-hover"
                }`}
              >
                {SECTOR_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <Field label="Ticket mínimo" hint="USD">
          <input
            value={minTicket}
            onChange={(e) => setMinTicket(e.target.value)}
            inputMode="numeric"
            className={inputClass}
          />
        </Field>

        <Field label="Programación" hint="cron · vacío = manual">
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 3 * * 1"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <section className="mt-4 rounded-xl border border-line bg-card p-2.5">
          <h3 className="text-sm2 font-medium">Antes de gastar</h3>
          <dl className="mt-1.5 font-mono text-2xs">
            <div className="flex justify-between">
              <dt style={{ color: "var(--dim)" }}>Negocios estimados</dt>
              <dd className="tabular-nums">≈ {estimate.businesses.toLocaleString("es-ES")}</dd>
            </div>
            <div className="mt-1 flex justify-between">
              <dt style={{ color: "var(--dim)" }}>Coste de Places</dt>
              <dd className="tabular-nums">≈ {moneyExact(estimate.costUsd)}</dd>
            </div>
          </dl>
          <p className="mt-1.5 text-2xs" style={{ color: "var(--dim2)" }}>
            Estimado por área, no consultado: preguntarle a Places cuántos hay costaría justo
            lo que se quiere estimar antes de gastar.
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
        {message && (
          <p className="mt-3 text-sm2" style={{ color: "var(--ok)" }}>
            {message}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 gap-2 border-t border-line p-3">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={pending}
          className="h-8 flex-1 rounded-md text-base whitespace-nowrap disabled:opacity-45"
          style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
        >
          Guardar y escanear
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={pending}
          className="h-8 flex-1 rounded-md border border-line2 text-base whitespace-nowrap disabled:opacity-45"
          style={{ color: "var(--muted)" }}
        >
          Solo guardar
        </button>
      </footer>
    </aside>
  );
}

/** El botón de escaneo de cada fila de la tabla. */
export function ScanZoneButton({ zoneId }: { zoneId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "queued" | "error">("idle");

  if (state === "queued") {
    return (
      <span className="font-mono text-2xs whitespace-nowrap" style={{ color: "var(--ok)" }}>
        en cola
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          const result = await scanZoneNow(zoneId);
          setState(result.ok ? "queued" : "error");
        })
      }
      disabled={pending}
      className="h-7 rounded-md border border-line2 px-2 text-2xs whitespace-nowrap transition-colors hover:bg-hover disabled:opacity-45"
      style={{ color: state === "error" ? "var(--crit)" : "var(--muted)" }}
    >
      {pending ? "…" : state === "error" ? "falló" : "Escanear"}
    </button>
  );
}
