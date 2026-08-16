/**
 * El parser de robots.txt.
 *
 * La vista de Traza enseña "robots.txt respetado" como señal de cumplimiento,
 * así que este parser es lo que sostiene esa afirmación delante de quien
 * pregunte. Merece que se compruebe, sobre todo el `Crawl-delay`, que estuvo
 * sin implementar con un argumento falso: que 1 req/s ya era más conservador
 * "que casi cualquier valor publicado". Un `Crawl-delay: 3` es de lo más común.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRobots } from "./robots";

const UA = "BorsogaProspector/0.1 (+https://borsoga.studio/bot)";

describe("parseRobots", () => {
  it("aplica las reglas del comodín cuando no hay nada específico", () => {
    const r = parseRobots("User-agent: *\nDisallow: /wp-admin/", UA);
    assert.deepEqual(r.disallow, ["/wp-admin/"]);
  });

  it("lee el Crawl-delay del comodín", () => {
    const r = parseRobots("User-agent: *\nDisallow: /admin/\nCrawl-delay: 3", UA);
    assert.equal(r.crawlDelaySeconds, 3);
  });

  it("ignora un Crawl-delay que no es un número positivo", () => {
    assert.equal(parseRobots("User-agent: *\nCrawl-delay: mucho", UA).crawlDelaySeconds, null);
    assert.equal(parseRobots("User-agent: *\nCrawl-delay: 0", UA).crawlDelaySeconds, null);
    assert.equal(parseRobots("User-agent: *\nCrawl-delay: -5", UA).crawlDelaySeconds, null);
  });

  it("prefiere el bloque dirigido a nosotros sobre el comodín", () => {
    const texto = [
      "User-agent: *",
      "Disallow: /",
      "Crawl-delay: 30",
      "",
      "User-agent: BorsogaProspector",
      "Disallow: /privado/",
      "Crawl-delay: 2",
    ].join("\n");

    const r = parseRobots(texto, UA);
    assert.deepEqual(r.disallow, ["/privado/"]);
    assert.equal(r.crawlDelaySeconds, 2);
  });

  it("no se traga las reglas de otro bot", () => {
    const texto = ["User-agent: Googlebot", "Disallow: /", "", "User-agent: *", "Disallow: /tmp/"].join(
      "\n",
    );
    assert.deepEqual(parseRobots(texto, UA).disallow, ["/tmp/"]);
  });

  it("descarta comentarios y líneas sueltas", () => {
    const texto = ["# esto es un comentario", "User-agent: *", "Disallow: /x/ # con nota", "basura"].join(
      "\n",
    );
    assert.deepEqual(parseRobots(texto, UA).disallow, ["/x/"]);
  });

  it("un robots.txt vacío no prohíbe nada", () => {
    const r = parseRobots("", UA);
    assert.deepEqual(r.disallow, []);
    assert.equal(r.crawlDelaySeconds, null);
  });
});
