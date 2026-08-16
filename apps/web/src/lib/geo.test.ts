/**
 * La geometría del área. Son cuatro fórmulas cortas, pero una de ellas —la
 * corrección por latitud— ya se escribió mal una vez: sin ella el círculo de
 * búsqueda sale ovalado y los prospectos aparecen desplazados respecto a donde
 * están de verdad.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { areaBounds, areaPolygon, distanceMeters, metersPerDegreeLng, zoomForRadius } from "./geo";

/** Miami, que es donde vive el producto. */
const MIAMI = { centerLat: 25.7617, centerLng: -80.1918, radiusMeters: 8_000 };

describe("metersPerDegreeLng", () => {
  it("un grado mide menos cuanto más lejos del ecuador", () => {
    assert.ok(metersPerDegreeLng(25.76) < metersPerDegreeLng(0));
    assert.ok(metersPerDegreeLng(60) < metersPerDegreeLng(25.76));
  });

  it("en Miami ronda los 100 km, un 10 % menos que en el ecuador", () => {
    const enMiami = metersPerDegreeLng(25.7617);
    assert.ok(enMiami > 100_000 && enMiami < 101_000, `salió ${enMiami}`);
  });

  it("no devuelve cero en el polo, donde la fórmula se degenera", () => {
    // Un cero se propagaría como división por cero al proyectar.
    assert.notEqual(metersPerDegreeLng(90), 0);
  });
});

describe("distanceMeters", () => {
  it("es cero entre un punto y sí mismo", () => {
    assert.equal(distanceMeters({ lat: 25.76, lng: -80.19 }, { lat: 25.76, lng: -80.19 }), 0);
  });

  it("un grado de latitud son unos 111 km", () => {
    const d = distanceMeters({ lat: 25, lng: -80 }, { lat: 26, lng: -80 });
    assert.ok(d > 111_000 && d < 111_500, `salió ${d}`);
  });

  it("es simétrica a esta escala", () => {
    const a = { lat: 25.76, lng: -80.19 };
    const b = { lat: 25.8, lng: -80.25 };
    assert.ok(Math.abs(distanceMeters(a, b) - distanceMeters(b, a)) < 1);
  });
});

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

describe("zoomForRadius", () => {
  it("un área más grande necesita menos zoom", () => {
    assert.ok(zoomForRadius(25.76, 20_000, 600) < zoomForRadius(25.76, 2_000, 600));
  });

  it("se queda dentro de los límites que acepta el mapa", () => {
    assert.ok(zoomForRadius(25.76, 1, 600) <= 16);
    assert.ok(zoomForRadius(25.76, 10_000_000, 600) >= 8);
  });
});
