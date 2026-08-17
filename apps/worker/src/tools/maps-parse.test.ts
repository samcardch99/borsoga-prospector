/**
 * Los bloques de texto de estas pruebas son capturas reales del DOM de Google
 * Maps, no invenciones. Es lo único que hace que estas pruebas valgan algo: el
 * día que Google cambie el formato, lo que hay que actualizar es este archivo, y
 * la forma de hacerlo es volver a copiar una tarjeta de verdad.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCardText, parseHref, toCard } from "./maps-parse";

const ORGANICA = [
  "Florida one kitchen cabinets Inc",
  "Florida one kitchen cabinets Inc",
  "4.9(379)",
  "Kitchen remodeler ·  · 11190 NW 25th St #120",
  "Open · Closes 5 PM · +1 786-928-8828",
  "",
  '"The cabinets look stunning and demonstrate superb work."',
].join("\n");

const PATROCINADA = [
  "Fuse Speciality Appliances & Plumbing",
  "Sponsored",
  "",
  "Fuse Speciality Appliances & Plumbing",
  "4.6(388)",
  "Appliance store · 2644 Southwest 28th Lane",
  "Open · Closes 5 PM · (305) 433-6189",
].join("\n");

const HREF =
  "/maps/place/Florida+one+kitchen+cabinets+Inc/@25.8123456,-80.3456789,17z/" +
  "data=!3m1!4b1!4m6!3m5!1s0x88d9b7c4c4e1d9a7:0x6a7de4838564084a!8m2!3d25.8199!4d-80.3402!16s%2Fg%2F11abc";

describe("parseHref", () => {
  it("saca el id estable y prefiere la coordenada del negocio", () => {
    const r = parseHref(HREF);
    assert.equal(r.ftid, "0x88d9b7c4c4e1d9a7:0x6a7de4838564084a");
    // !3d/!4d, no el @ del encuadre: son puntos distintos.
    assert.equal(r.lat, 25.8199);
    assert.equal(r.lng, -80.3402);
  });

  it("cae al encuadre cuando no hay coordenada del negocio", () => {
    const r = parseHref("/maps/place/X/@25.77,-80.19,15z/data=!4m2!3m1!1s0x1:0x2");
    assert.equal(r.ftid, "0x1:0x2");
    assert.equal(r.lat, 25.77);
    assert.equal(r.lng, -80.19);
  });

  it("devuelve ftid nulo cuando el enlace no lo trae", () => {
    assert.equal(parseHref("/maps/place/Algo/@25.7,-80.1,15z").ftid, null);
  });
});

describe("parseCardText", () => {
  it("lee una tarjeta orgánica entera", () => {
    const r = parseCardText(ORGANICA);
    assert.equal(r.rating, 4.9);
    assert.equal(r.reviewCount, 379);
    assert.equal(r.category, "Kitchen remodeler");
    assert.equal(r.address, "11190 NW 25th St #120");
    assert.equal(r.phone, "+1 786-928-8828");
    assert.equal(r.sponsored, false);
  });

  it("marca las patrocinadas y lee su teléfono entre paréntesis", () => {
    const r = parseCardText(PATROCINADA);
    assert.equal(r.sponsored, true);
    assert.equal(r.category, "Appliance store");
    assert.equal(r.address, "2644 Southwest 28th Lane");
    assert.equal(r.phone, "(305) 433-6189");
  });

  it("no confunde la línea de horario con la de dirección", () => {
    // Las dos llevan `·`; la de horario se reconoce por cómo empieza.
    const r = parseCardText("Sin Nota SL\nSin Nota SL\nCarpenter · 683 W 27th St\nOpen · Closes 4:30 PM");
    assert.equal(r.category, "Carpenter");
    assert.equal(r.address, "683 W 27th St");
  });

  it("aguanta un negocio sin nota, donde la dirección sube de línea", () => {
    const r = parseCardText("Nuevo Taller\nNuevo Taller\nCabinet maker · 100 SW 1st Ave");
    assert.equal(r.rating, null);
    assert.equal(r.reviewCount, null);
    assert.equal(r.address, "100 SW 1st Ave");
  });

  it("lee números de reseñas con separador de millares", () => {
    const r = parseCardText("X\nX\n4.5(1,204)\nStore · 1 Main St");
    assert.equal(r.reviewCount, 1204);
  });

  it("acepta la nota con coma decimal por si el idioma no se aplicó", () => {
    assert.equal(parseCardText("X\n4,6(388)\nStore · 1 Main St").rating, 4.6);
  });

  it("devuelve null en vez de inventar cuando no hay nada que leer", () => {
    const r = parseCardText("Solo un nombre");
    assert.equal(r.category, null);
    assert.equal(r.address, null);
    assert.equal(r.phone, null);
    assert.equal(r.rating, null);
  });

  it("no toma el número de reseñas por un teléfono", () => {
    assert.equal(parseCardText("X\nX\n4.9(379)\nStore · 1 Main St").phone, null);
  });
});

describe("toCard", () => {
  it("junta enlace y texto", () => {
    const card = toCard({ name: "Florida one kitchen cabinets Inc ", href: HREF, text: ORGANICA });
    assert.ok(card);
    assert.equal(card.name, "Florida one kitchen cabinets Inc");
    assert.equal(card.ftid, "0x88d9b7c4c4e1d9a7:0x6a7de4838564084a");
    assert.equal(card.rating, 4.9);
    assert.equal(card.website, null); // La trae la ficha, no el listado.
  });

  it("descarta la tarjeta sin id estable: no habría con qué deduplicar", () => {
    assert.equal(toCard({ name: "X", href: "/maps/place/X/@1,2,15z", text: "X" }), null);
  });
});
