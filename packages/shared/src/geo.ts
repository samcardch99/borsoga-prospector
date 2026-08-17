/**
 * Geometría del área de búsqueda.
 *
 * Vive en `shared` porque la usan los dos lados: la web para pintar el círculo
 * de la zona y colocar los marcadores, y el worker para decidir si un negocio
 * que devolvió una búsqueda cae dentro del radio o se descarta por lejano.
 *
 * Las conversiones son aproximaciones planas, y a esta escala sobran: una zona
 * son kilómetros, no cientos, y a esa distancia tratar la Tierra como plana se
 * equivoca en metros. Lo que no se puede es ignorar la latitud — un grado de
 * longitud en Miami mide un 10 % menos que en el ecuador, y sin corregirlo el
 * círculo saldría ovalado.
 */

/** Metros por grado de latitud. Constante a efectos prácticos. */
export const M_PER_DEG_LAT = 111_320;

export function metersPerDegreeLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || 1;
}

export interface Area {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
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

/** Zoom que mete el diámetro del área en un viewport de ancho dado. */
export function zoomForRadius(lat: number, radiusMeters: number, viewportPx: number): number {
  const metersPerPixel = (2 * radiusMeters * 1.3) / viewportPx;
  const atZoom0 = 156_543.03392 * Math.cos((lat * Math.PI) / 180);
  const zoom = Math.log2(atZoom0 / metersPerPixel);
  return Math.min(16, Math.max(8, zoom));
}
