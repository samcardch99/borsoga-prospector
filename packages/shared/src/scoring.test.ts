/**
 * El score es el número que ordena la lista, colorea el marcador y decide el
 * ticket. Si se rompe en silencio, la herramienta sigue funcionando y
 * priorizando mal — que es la peor forma de romperse.
 *
 * Estos tests fijan la fórmula del handoff §5, no la implementación: si alguien
 * ajusta los pesos con datos reales (que es lo que el handoff pide), estos
 * fallan y hay que actualizarlos a propósito. Ese es justamente el aviso que se
 * quiere.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { branchScore, branchScores, scoreBand, totalScore } from "./scoring";
import type { ScorableFinding } from "./scoring";

const f = (
  branch: ScorableFinding["branch"],
  severity: ScorableFinding["severity"],
  verdict: ScorableFinding["verdict"],
): ScorableFinding => ({ branch, severity, verdict });

describe("branchScore", () => {
  it("es cero sin hallazgos", () => {
    assert.equal(branchScore([]), 0);
  });

  it("pondera severidad por veredicto", () => {
    // critical(10) × confirmed(1) = 10 sobre la saturación de 24 → 42
    assert.equal(branchScore([f("web", "critical", "confirmed")]), 42);
    // El mismo hallazgo pendiente vale la mitad.
    assert.equal(branchScore([f("web", "critical", "pending")]), 21);
  });

  it("un descartado no suma nada", () => {
    assert.equal(branchScore([f("web", "critical", "discarded")]), 0);
  });

  it("satura en 100 y no lo pasa", () => {
    const muchos = Array.from({ length: 10 }, () => f("web", "critical", "confirmed"));
    assert.equal(branchScore(muchos), 100);
  });
});

describe("branchScores", () => {
  it("devuelve las tres ramas aunque estén vacías", () => {
    const s = branchScores([f("web", "high", "confirmed")]);
    assert.deepEqual(Object.keys(s).sort(), ["branding", "renders", "web"]);
    assert.equal(s.renders, 0);
    assert.equal(s.branding, 0);
    assert.ok(s.web > 0);
  });
});

describe("totalScore", () => {
  it("pesa 45/35/20 entre rama principal, segunda y encaje", () => {
    // web: critical confirmado → 42. renders: high confirmado → 25.
    const result = totalScore(
      [f("web", "critical", "confirmed"), f("renders", "high", "confirmed")],
      100,
    );
    // 0,45×42 + 0,35×25 + 0,20×100 = 18,9 + 8,75 + 20 = 47,65 → 48
    assert.equal(result.score, 48);
  });

  it("dos prospectos con la misma suma se ordenan por dónde está su fuerza", () => {
    // Toda la fuerza en una rama pesa más que repartida, porque la principal
    // pondera 0,45 y la segunda 0,35. Es la tesis del handoff §5.
    const concentrado = totalScore([f("web", "critical", "confirmed")], 0).score;
    const repartido = totalScore(
      [f("web", "medium", "confirmed"), f("renders", "medium", "confirmed")],
      0,
    ).score;
    assert.ok(
      concentrado > repartido,
      `concentrado ${concentrado} debería superar a repartido ${repartido}`,
    );
  });

  it("guarda los factores para poder explicar el número", () => {
    const { factors } = totalScore([f("web", "low", "pending")], 60);
    assert.equal(factors.length, 3);
    assert.ok(factors.every((x) => typeof x.label === "string" && x.label.length > 0));
    assert.equal(
      factors.reduce((sum, x) => sum + x.weight, 0),
      1,
    );
  });

  it("sin hallazgos, el score sale solo del encaje de ICP", () => {
    // 0,45×0 + 0,35×0 + 0,20×100 = 20
    assert.equal(totalScore([], 100).score, 20);
  });
});

describe("scoreBand", () => {
  it("corta en 70 y en 45", () => {
    assert.equal(scoreBand(70), "high");
    assert.equal(scoreBand(69), "mid");
    assert.equal(scoreBand(45), "mid");
    assert.equal(scoreBand(44), "low");
    assert.equal(scoreBand(0), "low");
  });
});
