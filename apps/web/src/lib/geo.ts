/**
 * Geometría del mapa: lo que hace falta para *pintar* el área.
 *
 * La aritmética de coordenadas —metros por grado, distancias, zoom— vive en
 * `@borsoga/shared`, porque el worker la necesita igual para decidir si un
 * negocio cae dentro del radio de la zona. Aquí queda solo lo que produce
 * GeoJSON o coordenadas de pantalla, que es cosa de la interfaz.
 */

import type { FeatureCollection } from "geojson";
import { M_PER_DEG_LAT, metersPerDegreeLng, type Area } from "@borsoga/shared";

export { distanceMeters, metersPerDegreeLng, zoomForRadius, type Area } from "@borsoga/shared";

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

