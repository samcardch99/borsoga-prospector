/**
 * `resolveEvidence` es donde se hace cumplir la regla que sostiene el producto
 * entero: **sin evidencia no hay hallazgo**.
 *
 * El agente conduce el proceso y decide qué mirar, pero no puede afirmar haber
 * visto algo que ninguna herramienta vio. Esta función es el punto exacto donde
 * eso se comprueba, y por eso es la que más merece un test: si algún día
 * empieza a devolver algo para un `evidenceRef` inventado, el worker escribirá
 * hallazgos sin prueba y la herramienta dejará de ser defendible sin que nada
 * falle a la vista.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveEvidence } from "./agent";
import type { AgentRun, Observation } from "./agent";

function obs(id: string, url: string, quote: string): Observation {
  return {
    id,
    tool: "render_dom",
    url,
    quote,
    layer: "rendered_dom",
    method: "navegador real · 1440×900",
    capturedAt: "2026-08-15T12:00:00.000Z",
  };
}

function run(observations: Observation[]): AgentRun {
  return {
    json: {},
    toolCalls: [],
    observations: new Map(observations.map((o) => [o.id, o])),
    turns: 1,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    stopReason: "completed",
    model: "test",
  };
}

describe("resolveEvidence", () => {
  it("rechaza un ref que no vio ninguna herramienta", () => {
    const r = run([obs("obs_1", "https://ejemplo.com/", "lo que se vio")]);
    assert.equal(resolveEvidence(r, "obs_inventado"), null);
  });

  it("rechaza cualquier ref cuando el run no observó nada", () => {
    assert.equal(resolveEvidence(run([]), "obs_1"), null);
  });

  it("devuelve la observación real, sin dejar que el agente la reescriba", () => {
    const original = obs("obs_1", "https://ejemplo.com/", "61 imágenes, 39 sin alt");
    const resolved = resolveEvidence(run([original]), "obs_1");

    assert.ok(resolved);
    // La URL, la cita y la fecha salen de la observación y no del hallazgo: el
    // agente cita un id, no redacta la prueba.
    assert.equal(resolved.url, original.url);
    assert.equal(resolved.quote, original.quote);
    assert.equal(resolved.capturedAt, original.capturedAt);
    assert.equal(resolved.layer, original.layer);
    assert.equal(resolved.method, original.method);
  });

  it("suma las fuentes adicionales que sí existen y descarta las que no", () => {
    const r = run([
      obs("obs_1", "https://ejemplo.com/", "principal"),
      obs("obs_2", "https://ejemplo.com/precios", "secundaria"),
    ]);

    const resolved = resolveEvidence(r, "obs_1", ["obs_2", "obs_fantasma"]);

    assert.ok(resolved);
    assert.equal(resolved.additionalSources?.length, 1);
    assert.equal(resolved.additionalSources?.[0]?.url, "https://ejemplo.com/precios");
  });

  it("no inventa fuentes adicionales cuando no se piden", () => {
    const resolved = resolveEvidence(run([obs("obs_1", "https://ejemplo.com/", "x")]), "obs_1");
    assert.ok(resolved);
    assert.equal(resolved.additionalSources, undefined);
  });
});
