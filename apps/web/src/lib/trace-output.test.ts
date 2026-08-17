import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { screenshotKeyOf } from "./trace-output";

describe("screenshotKeyOf", () => {
  it("devuelve la clave de la primera observación que tenga captura", () => {
    const output = {
      observations: [
        { id: "a", screenshot: null },
        { id: "b", screenshot: "scan-1/hash.png" },
        { id: "c", screenshot: "scan-1/otra.png" },
      ],
    };
    assert.equal(screenshotKeyOf(output), "scan-1/hash.png");
  });

  it("devuelve null cuando ninguna observación tiene captura", () => {
    assert.equal(screenshotKeyOf({ observations: [{ id: "a" }, { id: "b", screenshot: null }] }), null);
  });

  it("aguanta el output de un paso fallido, que no lleva observaciones", () => {
    assert.equal(screenshotKeyOf({ errorCode: "SCREENSHOT_FAILED" }), null);
  });

  /*
   * Estos tres son el fallo real que tumbó la página: `output` es jsonb libre y
   * las filas viejas traen cualquier cosa donde ahora se espera un array.
   */
  it("aguanta que observations no sea un array", () => {
    assert.equal(screenshotKeyOf({ observations: { id: "a" } }), null);
    assert.equal(screenshotKeyOf({ observations: "ninguna" }), null);
    assert.equal(screenshotKeyOf({ observations: 3 }), null);
  });

  it("aguanta que el propio output no sea un objeto", () => {
    assert.equal(screenshotKeyOf(null), null);
    assert.equal(screenshotKeyOf(undefined), null);
    assert.equal(screenshotKeyOf("texto suelto"), null);
    assert.equal(screenshotKeyOf([1, 2, 3]), null);
  });

  it("aguanta observaciones nulas o con una captura que no es texto", () => {
    assert.equal(screenshotKeyOf({ observations: [null, { screenshot: 42 }] }), null);
  });

  it("descarta la cadena vacía, que no es una clave utilizable", () => {
    assert.equal(screenshotKeyOf({ observations: [{ screenshot: "" }, { screenshot: "k.png" }] }), "k.png");
  });
});
