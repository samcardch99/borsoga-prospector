/**
 * Los primeros tests del repositorio, y están aquí por un motivo concreto: al
 * escribir el planificador salió un fallo que ninguna revisión de código habría
 * pillado. Las expresiones cron se interpretan en una zona horaria, y si no se
 * fija, `0 3 * * 1` significa cosas distintas según dónde corra el worker.
 *
 * `isDue` es una función pura sobre fechas: exactamente el tipo de código donde
 * un test vale más que leerlo dos veces. Corre con el runner de Node, sin
 * dependencias: `pnpm --filter @borsoga/worker test`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDue } from "./schedule-rule";

/** Anterior a todo lo demás; solo importa cuando no hay último escaneo. */
const CREADA = new Date("2026-01-01T00:00:00Z");

/*
 * En agosto Florida va en EDT (UTC-4), así que las 3:00 locales son las 07:00Z.
 * Las fechas van en UTC a propósito: escribirlas en local escondería justo la
 * conversión que se quiere comprobar.
 */
describe("isDue", () => {
  it("no dispara una semanal recién escaneada", () => {
    assert.equal(
      isDue("0 3 * * 1", new Date("2026-08-10T07:00:00Z"), CREADA, new Date("2026-08-10T13:00:00Z")),
      false,
    );
  });

  it("dispara una semanal cuando ha pasado la semana", () => {
    assert.equal(
      isDue("0 3 * * 1", new Date("2026-08-10T07:00:00Z"), CREADA, new Date("2026-08-17T08:00:00Z")),
      true,
    );
  });

  it("interpreta el cron en hora de Florida y no en UTC", () => {
    // 03:00Z del lunes es domingo 23:00 en Florida, así que el lunes a las 3:00
    // locales todavía está por delante y toca. Con UTC daría lo contrario.
    assert.equal(
      isDue("0 3 * * 1", new Date("2026-08-10T03:00:00Z"), CREADA, new Date("2026-08-10T13:00:00Z")),
      true,
    );
  });

  it("dispara una horaria que lleva dos horas sin correr", () => {
    assert.equal(
      isDue("0 * * * *", new Date("2026-08-15T10:00:00Z"), CREADA, new Date("2026-08-15T12:05:00Z")),
      true,
    );
  });

  it("no dispara una horaria que corrió hace diez minutos", () => {
    assert.equal(
      isDue("0 * * * *", new Date("2026-08-15T12:00:00Z"), CREADA, new Date("2026-08-15T12:10:00Z")),
      false,
    );
  });

  it("usa la fecha de creación cuando la zona no se ha escaneado nunca", () => {
    assert.equal(isDue("0 3 * * *", null, CREADA, new Date("2026-01-02T09:00:00Z")), true);
  });

  it("recupera el turno perdido si el worker estuvo apagado", () => {
    // Semanal, tres semanas sin correr: tiene que dispararse al volver, no
    // esperar a la semana siguiente.
    assert.equal(
      isDue("0 3 * * 1", new Date("2026-07-20T07:00:00Z"), CREADA, new Date("2026-08-11T09:00:00Z")),
      true,
    );
  });

  it("no revienta con una expresión inválida", () => {
    assert.equal(isDue("esto no es cron", null, CREADA, new Date()), false);
  });
});
