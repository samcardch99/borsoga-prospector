/**
 * Lectura de `robots.txt`. Solo el parser: sin configuración, sin red.
 *
 * Está separado de `politeness.ts` por el mismo motivo que la regla de
 * programación lo está del planificador: importar aquel arrastra la config del
 * worker, que se valida al cargarse, y un test de una función pura no debería
 * necesitar un entorno completo. Cuando probar algo cuesta, suele ser que están
 * mezcladas dos cosas.
 */

export interface RobotsRules {
  /** Prefijos prohibidos para nuestro user-agent (o para `*`). */
  disallow: string[];
  allow: string[];
  /** Segundos que pide el sitio entre peticiones, si lo pide. */
  crawlDelaySeconds: number | null;
}


/**
 * Parser deliberadamente pequeño: `User-agent`, `Allow`, `Disallow` y
 * `Crawl-delay`.
 *
 * El `Crawl-delay` estuvo sin implementar con el argumento de que 1 req/s ya es
 * más conservador "que casi cualquier valor publicado". Es falso en cuanto un
 * sitio pide 3 segundos, que es de lo más común — y la vista de Traza presume
 * de "robots.txt respetado", así que ignorar una directiva del propio
 * robots.txt convertía esa señal en una verdad a medias.
 */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const ua = userAgent.toLowerCase();
  const nuestras: RobotsRules = { disallow: [], allow: [], crawlDelaySeconds: null };
  const comodin: RobotsRules = { disallow: [], allow: [], crawlDelaySeconds: null };

  /*
   * Tres destinos y no dos. La primera versión mandaba al comodín todo lo que
   * no fuera nuestro, así que las reglas de otros bots acababan aplicándose a
   * nosotros: un sitio con `User-agent: Googlebot / Disallow: /` nos dejaba
   * creyendo que teníamos el sitio entero prohibido. Lo de otros se descarta.
   */
  let destino: RobotsRules | null = null;
  let sawSpecific = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      const agent = value.toLowerCase();
      if (agent === "*") destino = comodin;
      else if (ua.includes(agent) || agent.includes("borsoga")) {
        destino = nuestras;
        sawSpecific = true;
      } else destino = null;
      continue;
    }

    const target = destino;
    if (!target) continue;

    if (field === "disallow" && value) target.disallow.push(value);
    else if (field === "allow" && value) target.allow.push(value);
    else if (field === "crawl-delay" && value) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) target.crawlDelaySeconds = seconds;
    }
  }

  return sawSpecific ? nuestras : comodin;
}
