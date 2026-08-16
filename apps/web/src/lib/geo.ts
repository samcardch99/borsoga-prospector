/**
 * Geometría del área de búsqueda. La usan los dos mapas: el grande de la vista
 * principal y el mini mapa del formulario de zona.
 *
 * Las conversiones son aproximaciones planas, y a esta escala sobran: una zona
 * son kilómetros, no cientos, y a esa distancia tratar la Tierra como plana se
 * equivoca en metros. Lo que no se puede es ignorar la latitud — un grado de
 * longitud en Miami mide un 10 % menos que en el ecuador, y sin corregirlo el
 * círculo saldría ovalado.
 */

import type { FeatureCollection } from "geojson";

/** Metros por grado de latitud. Constante a efectos prácticos. */
const M_PER_DEG_LAT = 111_320;

export function metersPerDegreeLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || 1;
}

export interface Area {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

/** El área como polígono geográfico, para pintarla en un mapa de verdad. */
export function areaPolygon(area: Area, steps = 96): FeatureCollection {
  const latDelta = area.radiusMeters / M_PER_DEG_LAT;
  const lngDelta = area.radiusMeters / metersPerDegreeLng(area.centerLat);

  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([
      area.centerLng + lngDelta * Math.cos(angle),
      area.centerLat + latDelta * Math.sin(angle),
    ]);
  }

  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
    ],
  };
}

/** El punto del borde este del círculo: el asa con la que se cambia el radio. */
export function radiusHandle(area: Area): { lat: number; lng: number } {
  return {
    lat: area.centerLat,
    lng: area.centerLng + area.radiusMeters / metersPerDegreeLng(area.centerLat),
  };
}

/**
 * Distancia aproximada en metros entre dos puntos cercanos.
 *
 * La conversión de longitud usa la latitud **media** de los dos puntos y no la
 * del primero. Con la del primero, `distancia(a, b)` y `distancia(b, a)` daban
 * resultados distintos — poco, pero una distancia que depende del orden de los
 * argumentos es una trampa esperando a que alguien la pise.
 */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * metersPerDegreeLng((a.lat + b.lat) / 2);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * El rectángulo que envuelve el área, como `[[oeste, sur], [este, norte]]`.
 *
 * Se usa en vez de calcular un zoom a mano cuando el contenedor es pequeño o de
 * proporción rara: el zoom hay que ajustarlo a la dimensión *menor* del hueco,
 * y acertar eso a ojo sale mal. Dándole los límites, MapLibre encaja el círculo
 * mire como mire la caja.
 */
export function areaBounds(area: Area): [[number, number], [number, number]] {
  const latDelta = area.radiusMeters / M_PER_DEG_LAT;
  const lngDelta = area.radiusMeters / metersPerDegreeLng(area.centerLat);

  return [
    [area.centerLng - lngDelta, area.centerLat - latDelta],
    [area.centerLng + lngDelta, area.centerLat + latDelta],
  ];
}

/** Zoom que mete el diámetro del área en un viewport de ancho dado. */
export function zoomForRadius(lat: number, radiusMeters: number, viewportPx: number): number {
  const metersPerPixel = (2 * radiusMeters * 1.3) / viewportPx;
  const atZoom0 = 156_543.03392 * Math.cos((lat * Math.PI) / 180);
  const zoom = Math.log2(atZoom0 / metersPerPixel);
  return Math.min(16, Math.max(8, zoom));
}
