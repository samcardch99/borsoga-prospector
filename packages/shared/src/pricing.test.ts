/**
 * El ticket es una cifra que acaba impresa en una propuesta que se manda a un
 * cliente. Vale la pena que su cálculo esté clavado.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_TICKET_USD, branchTicket, branchTickets, ticketEstimate } from "./pricing";

describe("branchTicket", () => {
  it("una rama sin puntuar no cuesta nada", () => {
    assert.equal(branchTicket("web", 0), 0);
  });

  it("va de media base a base y media según el score", () => {
    // score 0 se filtra antes; con 1 el factor es 0,51 y con 100 es 1,5.
    assert.equal(branchTicket("web", 100), Math.round((BASE_TICKET_USD.web * 1.5) / 500) * 500);
    assert.ok(branchTicket("web", 50) < branchTicket("web", 100));
    assert.ok(branchTicket("web", 50) > branchTicket("web", 10));
  });

  it("redondea a 500 para no fingir una precisión que no hay", () => {
    for (const score of [7, 23, 41, 68, 99]) {
      assert.equal(branchTicket("renders", score) % 500, 0, `score ${score}`);
    }
  });

  it("cada rama parte de su propio importe base", () => {
    assert.ok(BASE_TICKET_USD.web > BASE_TICKET_USD.branding);
    assert.ok(BASE_TICKET_USD.branding > BASE_TICKET_USD.renders);
  });
});

describe("ticketEstimate", () => {
  it("suma solo las ramas con hallazgos", () => {
    const scores = { renders: 0, web: 60, branding: 0 };
    assert.equal(ticketEstimate(scores), branchTicket("web", 60));
  });

  it("es cero cuando no hay nada que vender", () => {
    assert.equal(ticketEstimate({ renders: 0, web: 0, branding: 0 }), 0);
  });

  it("coincide con la suma de branchTickets", () => {
    const scores = { renders: 30, web: 80, branding: 10 };
    const porRama = branchTickets(scores);
    assert.equal(
      ticketEstimate(scores),
      porRama.renders + porRama.web + porRama.branding,
    );
  });
});
