/**
 * Lo que esta capa aporta sobre `@borsoga/shared`: el GeoJSON del área y su
 * caja envolvente. La aritmética de coordenadas se prueba en shared, que es
 * donde vive.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { areaBounds, areaPolygon, distanceMeters, metersPerDegreeLng, zoomForRadius } from "./geo";

/** Miami, que es donde vive el producto. */
const MIAMI = { centerLat: 25.7617, centerLng: -80.1918, radiusMeters: 8_000 };

describe("areaPolygon", () => {
  it("cierra el anillo: el último punto es el primero", () => {
    const [feature] = areaPolygon(MIAMI).features;
    const ring = (feature?.geometry as { coordinates: number[][][] }).coordinates[0]!;
    assert.deepEqual(ring[0], ring[ring.length - 1]);
  });

  it("todos sus puntos quedan a la distancia del radio", () => {
    const [feature] = areaPolygon(MIAMI, 32).features;
    const ring = (feature?.geometry as { coordinates: number[][][] }).coordinates[0]!;

    for (const [lng, lat] of ring) {
      const d = distanceMeters(
        { lat: MIAMI.centerLat, lng: MIAMI.centerLng },
        { lat: lat!, lng: lng! },
      );
      // Un 1 % de holgura: la proyección plana no es exacta, pero a 8 km sobra.
      assert.ok(Math.abs(d - MIAMI.radiusMeters) < MIAMI.radiusMeters * 0.01, `salió ${d}`);
    }
  });
});

describe("areaBounds", () => {
  it("envuelve el círculo y lo deja centrado", () => {
    const [[oeste, sur], [este, norte]] = areaBounds(MIAMI);
    assert.ok(oeste < MIAMI.centerLng && este > MIAMI.centerLng);
    assert.ok(sur < MIAMI.centerLat && norte > MIAMI.centerLat);
    assert.ok(Math.abs((oeste + este) / 2 - MIAMI.centerLng) < 1e-9);
  });

  it("es más ancho en grados que alto, por la latitud", () => {
    const [[oeste, sur], [este, norte]] = areaBounds(MIAMI);
    assert.ok(este - oeste > norte - sur);
  });
});

