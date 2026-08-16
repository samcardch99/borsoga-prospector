/**
 * Formato de cifras y fechas. Parece trivial y no lo es: `money` sale en las
 * columnas estrechas de la lista y `moneyExact` en un documento que se manda a
 * un cliente, así que un redondeo mal puesto se ve fuera de casa.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { money, moneyExact, timeAgo } from "./display";

describe("money", () => {
  it("marca la ausencia con una raya, no con un cero", () => {
    // Un "$0" en la lista se lee como "vale cero"; la raya se lee como
    // "todavía no hay cifra", que es lo que pasa antes de auditar.
    assert.equal(money(0), "—");
    assert.equal(money(-100), "—");
    assert.equal(money(Number.NaN), "—");
  });

  it("abrevia a miles y a millones", () => {
    assert.equal(money(950), "$950");
    assert.equal(money(8_500), "$9K");
    assert.equal(money(48_000), "$48K");
    assert.equal(money(1_000_000), "$1M");
    assert.equal(money(1_500_000), "$1.5M");
  });
});

describe("moneyExact", () => {
  it("usa el símbolo delante y no el sufijo de es-ES", () => {
    // es-ES escribe "8500 US$", que desentona con el "$9K" de money() y rompe
    // la alineación en mono.
    const salida = moneyExact(8_500);
    assert.ok(salida.startsWith("$"), `salió ${salida}`);
    assert.ok(!salida.includes("US$"), `salió ${salida}`);
  });

  it("no arrastra decimales, pero sí separa los miles", () => {
    // La coma de "$8,500" es separador de miles, no parte decimal: en en-US el
    // punto es el que marcaría decimales.
    assert.equal(moneyExact(8_500.4), "$8,500");
    assert.ok(!moneyExact(8_500.4).includes("."));
  });
});

describe("timeAgo", () => {
  const ahora = new Date("2026-08-15T12:00:00Z");

  it("los primeros segundos no dicen un número", () => {
    assert.equal(timeAgo(new Date("2026-08-15T11:59:40Z"), ahora), "hace un momento");
  });

  it("sube de minutos a horas y a días", () => {
    assert.equal(timeAgo(new Date("2026-08-15T11:30:00Z"), ahora), "hace 30 min");
    assert.equal(timeAgo(new Date("2026-08-15T09:00:00Z"), ahora), "hace 3 h");
    assert.equal(timeAgo(new Date("2026-08-12T12:00:00Z"), ahora), "hace 3 d");
  });

  it("a partir del mes pasa a fecha, porque 'hace 47 d' no dice nada", () => {
    const viejo = timeAgo(new Date("2026-06-01T12:00:00Z"), ahora);
    assert.ok(!viejo.startsWith("hace"), `salió ${viejo}`);
  });

  it("acepta un 'ahora' inyectado para no depender del reloj", () => {
    // El servidor y el cliente renderizan en momentos distintos; sin poder
    // fijar `ahora`, dos renders del mismo dato darían textos diferentes y
    // React marcaría error de hidratación.
    const fecha = new Date("2026-08-15T11:00:00Z");
    assert.equal(timeAgo(fecha, ahora), timeAgo(fecha, ahora));
    assert.notEqual(timeAgo(fecha, ahora), timeAgo(fecha, new Date("2026-08-16T11:00:00Z")));
  });
});
