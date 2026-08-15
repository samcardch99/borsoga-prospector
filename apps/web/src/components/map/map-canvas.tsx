"use client";

/**
 * El mapa: columna central de la vista principal (handoff §6.1).
 *
 * MapLibre GL con tiles vectoriales de OpenFreeMap. Sin clave, sin registro y
 * sin facturación — pero el motivo de elegirlo no es el coste: el style JSON se
 * genera desde los tokens de `theme.css` (ver `lib/map-style.ts`), así que el
 * mapa cambia con el tema como cualquier otra superficie de la interfaz. Un
 * mapa de terceros estilizado en una consola ajena no puede hacer eso.
 *
 * Si los tiles no cargan —sin red, o el servicio caído— se cae al lienzo de
 * referencia con los prospectos proyectados sobre el área de búsqueda, y lo
 * dice en pantalla. La herramienta sigue usable sin mapa: la lista y el
 * expediente son lo que se trabaja.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Layer,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Source,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { BRANCH_META, type Branch } from "@borsoga/shared";
import type { ProspectRow, ScanSummary, ZoneSummary } from "@/lib/queries";
import { branchColor, money, moneyExact, scoreColor, scoreSurface } from "@/lib/display";
import { buildMapStyle } from "@/lib/map-style";
import { useMapPalette } from "@/lib/use-map-palette";

type ColorMode = "score" | "branch" | "ticket" | "crm";

const COLOR_MODES: Array<{ value: ColorMode; label: string }> = [
  { value: "score", label: "Score total" },
  { value: "branch", label: "Rama" },
  { value: "ticket", label: "Ticket" },
  { value: "crm", label: "CRM" },
];

/** La rama con más hallazgos: la que da el color en el modo "Rama". */
function dominantBranch(row: ProspectRow): Branch | null {
  const entries = Object.entries(row.branchCounts) as Array<[Branch, number]>;
  if (entries.length === 0) return null;
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

function markerColors(row: ProspectRow, mode: ColorMode): { fg: string; bg: string } {
  if (row.disqualified) return { fg: "var(--dim2)", bg: "var(--inset)" };

  switch (mode) {
    case "branch": {
      const branch = dominantBranch(row);
      return branch
        ? { fg: branchColor(branch), bg: "var(--panel)" }
        : { fg: "var(--dim)", bg: "var(--inset)" };
    }
    case "ticket": {
      // Tres tramos de ticket, con la misma rampa que el score para no meter
      // una cuarta escala de color en la interfaz.
      const t = row.ticketEstimate;
      if (t >= 60_000) return { fg: "var(--accent)", bg: "var(--accent-soft)" };
      if (t >= 25_000) return { fg: "var(--warn)", bg: "var(--warn-soft)" };
      return { fg: "var(--dim)", bg: "var(--inset)" };
    }
    case "crm":
      return row.contacted
        ? { fg: "var(--ok)", bg: "var(--panel)" }
        : { fg: "var(--dim)", bg: "var(--inset)" };
    case "score":
    default:
      return { fg: scoreColor(row.score), bg: scoreSurface(row.score) };
  }
}

function markerText(row: ProspectRow, mode: ColorMode): string {
  if (mode === "ticket") return money(row.ticketEstimate).replace("$", "");
  if (mode === "branch") {
    const branch = dominantBranch(row);
    return branch ? BRANCH_META[branch].letter : "–";
  }
  return String(row.score);
}

function ScoreMarker({
  row,
  mode,
  selected,
}: {
  row: ProspectRow;
  mode: ColorMode;
  selected: boolean;
}) {
  const { fg, bg } = markerColors(row, mode);
  const size = selected ? 38 : 29;

  return (
    <span
      className="relative grid cursor-pointer place-items-center"
      style={{ width: size, height: size }}
    >
      {selected && (
        <span
          className="animate-pulse-ring absolute inset-0 rounded-full"
          style={{ border: "2px solid var(--accent)" }}
          aria-hidden
        />
      )}
      <span
        className="grid h-full w-full place-items-center rounded-full font-mono font-medium shadow-sm"
        style={{
          background: selected ? "var(--accent)" : bg,
          color: selected ? "var(--accent-ink)" : fg,
          border: `1.5px solid ${selected ? "var(--accent)" : fg}`,
          fontSize: selected ? 12 : 10.5,
          opacity: row.disqualified ? 0.45 : 1,
        }}
      >
        {markerText(row, mode)}
      </span>
    </span>
  );
}

/**
 * El área de búsqueda como polígono geográfico, no como adorno CSS: así se
 * mueve y escala con el mapa, que es lo único que la hace decir la verdad
 * sobre qué se escaneó.
 */
function areaPolygon(zone: ZoneSummary, steps = 96): FeatureCollection {
  const latDelta = zone.radiusMeters / 111_320;
  const lngDelta =
    zone.radiusMeters / (111_320 * Math.cos((zone.centerLat * Math.PI) / 180) || 1);

  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([
      zone.centerLng + lngDelta * Math.cos(angle),
      zone.centerLat + latDelta * Math.sin(angle),
    ]);
  }

  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
    ],
  };
}

/** Zoom que mete el diámetro del área en el ancho típico de la columna. */
function zoomForRadius(lat: number, radiusMeters: number, viewportPx = 620): number {
  const metersPerPixel = (2 * radiusMeters * 1.3) / viewportPx;
  const atZoom0 = (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 1;
  const zoom = Math.log2(atZoom0 / metersPerPixel);
  return Math.min(16, Math.max(8, zoom));
}

function Legend({ mode }: { mode: ColorMode }) {
  const items =
    mode === "branch"
      ? (["renders", "web", "branding"] as const).map((b) => ({
          color: branchColor(b),
          label: BRANCH_META[b].label,
        }))
      : mode === "crm"
        ? [
            { color: "var(--ok)", label: "Contactado" },
            { color: "var(--dim)", label: "Sin contactar" },
          ]
        : [
            { color: "var(--accent)", label: mode === "ticket" ? "≥ $60K" : "Alto (70+)" },
            { color: "var(--warn)", label: mode === "ticket" ? "≥ $25K" : "Medio (45–69)" },
            { color: "var(--dim)", label: mode === "ticket" ? "< $25K" : "Bajo (<45)" },
          ];

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-line2 bg-glass px-2.5 py-2 backdrop-blur">
      <div className="flex flex-col gap-1">
        {items.map((i) => (
          <span key={i.label} className="flex items-center gap-1.5 text-2xs whitespace-nowrap">
            <span className="h-2 w-2 rounded-full" style={{ background: i.color }} />
            <span style={{ color: "var(--muted)" }}>{i.label}</span>
          </span>
        ))}
        <span className="mt-0.5 flex items-center gap-1.5 text-2xs whitespace-nowrap">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--dim2)", opacity: 0.45 }}
          />
          <span style={{ color: "var(--muted)" }}>Descartado</span>
        </span>
      </div>
    </div>
  );
}

function ScanPanel({ scan }: { scan: ScanSummary }) {
  const done = scan.progressTotal > 0 ? scan.progressAudited / scan.progressTotal : 0;

  return (
    <div className="absolute top-3 right-3 z-10 w-[248px] rounded-lg border border-line2 bg-glass p-2.5 backdrop-blur">
      <div className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: scan.status === "running" ? "var(--accent)" : "var(--warn)" }}
        />
        <span className="text-sm2 font-medium">
          {scan.status === "running" ? "Escaneo en curso" : "Escaneo detenido"}
        </span>
        <span className="ml-auto font-mono text-2xs" style={{ color: "var(--dim)" }}>
          {moneyExact(scan.totalCostUsd)}
        </span>
      </div>

      <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--inset)" }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round(done * 100)}%`, background: "var(--accent)" }}
        />
      </div>

      <div
        className="mt-1.5 flex justify-between font-mono text-2xs"
        style={{ color: "var(--dim)" }}
      >
        <span>
          {scan.progressAudited}/{scan.progressTotal} auditados
        </span>
        <span>{scan.progressDisqualified} fuera de ICP</span>
      </div>

      {scan.errorCode && (
        <div
          className="mt-2 border-l-2 pl-2 text-2xs"
          style={{ borderColor: "var(--crit)", color: "var(--crit)" }}
        >
          {scan.errorCode}
          {scan.errorMessage ? ` · ${scan.errorMessage}` : ""}
        </div>
      )}
    </div>
  );
}

export function MapCanvas({
  rows,
  selectedId,
  zone,
  scan,
}: {
  rows: ProspectRow[];
  selectedId: string | null;
  zone: ZoneSummary | null;
  scan: ScanSummary | null;
}) {
  const [mode, setMode] = useState<ColorMode>("score");
  const [tilesFailed, setTilesFailed] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const palette = useMapPalette();

  const mapStyle = useMemo(() => buildMapStyle(palette), [palette]);

  const select = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("p", id);
      router.push(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const controls = (
    <>
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-lg border border-line2 bg-glass p-0.5 backdrop-blur">
          {COLOR_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`h-6 rounded-[6px] px-2 text-2xs whitespace-nowrap transition-colors ${
                mode === m.value ? "bg-chip text-foreground" : "text-muted-foreground hover:bg-hover"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled
          title="Dibujar área llega en el paso 8, con la vista de Zonas"
          className="h-7 cursor-not-allowed rounded-lg border border-line2 bg-glass px-2.5 text-2xs whitespace-nowrap opacity-45 backdrop-blur"
          style={{ color: "var(--muted)" }}
        >
          Dibujar área
        </button>
      </div>

      {scan && (scan.status === "running" || scan.errorCode) && <ScanPanel scan={scan} />}
      <Legend mode={mode} />
    </>
  );

  if (!zone) {
    return (
      <div
        className="relative grid flex-1 place-items-center"
        style={{ background: "var(--map-bg)" }}
      >
        <p className="text-sm2" style={{ color: "var(--muted)" }}>
          No hay ninguna zona configurada todavía.
        </p>
      </div>
    );
  }

  if (tilesFailed) {
    return (
      <FallbackCanvas
        rows={rows}
        zone={zone}
        selectedId={selectedId}
        mode={mode}
        onSelect={select}
        controls={controls}
      />
    );
  }

  return (
    <div className="relative flex-1">
      <MapLibreMap
        initialViewState={{
          longitude: zone.centerLng,
          latitude: zone.centerLat,
          zoom: zoomForRadius(zone.centerLat, zone.radiusMeters),
        }}
        mapStyle={mapStyle}
        attributionControl={{ compact: true }}
        onError={() => setTilesFailed(true)}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        <Source id="area" type="geojson" data={areaPolygon(zone)}>
          <Layer
            id="area-relleno"
            type="fill"
            paint={{ "fill-color": palette.accent, "fill-opacity": 0.05 }}
          />
          <Layer
            id="area-borde"
            type="line"
            paint={{
              "line-color": palette.accent,
              "line-width": 1.5,
              "line-dasharray": [3, 3],
            }}
          />
        </Source>

        {rows.map((row) => (
          <Marker
            key={row.id}
            longitude={row.lng}
            latitude={row.lat}
            anchor="center"
            onClick={(e) => {
              // Sin esto el mapa recibe también el clic y deselecciona.
              e.originalEvent.stopPropagation();
              select(row.id);
            }}
          >
            <ScoreMarker row={row} mode={mode} selected={row.id === selectedId} />
          </Marker>
        ))}
      </MapLibreMap>

      {controls}
    </div>
  );
}

/**
 * Reserva cuando los tiles no cargan. Fondo tokenizado y prospectos proyectados
 * de verdad sobre el área. En claro la rampa se invierte (fondo claro, calles
 * más oscuras) — copiar la relación del modo oscuro deja el mapa en blanco,
 * handoff §9. Al salir de los tokens, eso ya viene resuelto.
 */
function FallbackCanvas({
  rows,
  zone,
  selectedId,
  mode,
  onSelect,
  controls,
}: {
  rows: ProspectRow[];
  zone: ZoneSummary;
  selectedId: string | null;
  mode: ColorMode;
  onSelect: (id: string) => void;
  controls: React.ReactNode;
}) {
  const positioned = useMemo(() => {
    const latDelta = zone.radiusMeters / 111_320;
    const lngDelta =
      zone.radiusMeters / (111_320 * Math.cos((zone.centerLat * Math.PI) / 180) || 1);
    const spanLat = latDelta * 1.35;
    const spanLng = lngDelta * 1.35;
    const clamp = (v: number) => Math.min(0.97, Math.max(0.03, v));

    return rows.map((row) => ({
      row,
      left: `${clamp((row.lng - (zone.centerLng - spanLng)) / (2 * spanLng)) * 100}%`,
      top: `${clamp(1 - (row.lat - (zone.centerLat - spanLat)) / (2 * spanLat)) * 100}%`,
    }));
  }, [rows, zone]);

  return (
    <div className="relative flex-1 overflow-hidden" style={{ background: "var(--map-bg)" }}>
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <pattern id="calles" width="72" height="72" patternUnits="userSpaceOnUse">
            <rect width="72" height="72" fill="var(--island)" />
            <path d="M0 36h72M36 0v72" stroke="var(--road1)" strokeWidth="6" />
            <path d="M0 12h72M12 0v72" stroke="var(--road2)" strokeWidth="2" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#calles)" />
      </svg>

      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          width: `${(1 / 1.35) * 100}%`,
          aspectRatio: "1",
          transform: "translate(-50%, -50%)",
          border: "1.5px dashed var(--accent-line)",
          background: "radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)",
        }}
      />

      {positioned.map(({ row, left, top }) => (
        <button
          key={row.id}
          type="button"
          onClick={() => onSelect(row.id)}
          title={`${row.name} · score ${row.score}`}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left, top, zIndex: row.id === selectedId ? 10 : 1 }}
        >
          <ScoreMarker row={row} mode={mode} selected={row.id === selectedId} />
        </button>
      ))}

      {controls}

      <p
        className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-md border border-line2 bg-glass px-2 py-1 text-2xs backdrop-blur"
        style={{ color: "var(--muted)" }}
      >
        Mapa de referencia · los tiles no cargaron
      </p>
    </div>
  );
}
