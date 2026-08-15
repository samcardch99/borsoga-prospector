/**
 * Buena vecindad: 1 petición por segundo y dominio, `robots.txt` respetado y
 * un user-agent identificable.
 *
 * Esto no es una cortesía opcional. El handoff §10.3 lo pide, y la vista de
 * Traza expone las señales a propósito (`robotsRespected`, `requestsPerSecond`,
 * `cacheHits`) — así que se miden aquí, en el único sitio por el que pasa todo
 * el tráfico saliente.
 */

import { config } from "../config";
import { log } from "../log";

const minIntervalMs = Math.ceil(1000 / Math.max(config.CRAWL_REQUESTS_PER_SECOND, 0.01));

/** Última salida programada por dominio. Encolar es sumar, no dormir a ojo. */
const nextSlot = new Map<string, number>();

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Espera hasta que le toque el turno a este dominio. */
export async function waitTurn(domain: string): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(domain) ?? 0);
  nextSlot.set(domain, slot + minIntervalMs);
  const delay = slot - now;
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
}

// ─── robots.txt ──────────────────────────────────────────────────────────────

interface RobotsRules {
  /** Prefijos prohibidos para nuestro user-agent (o para `*`). */
  disallow: string[];
  allow: string[];
}

const robotsCache = new Map<string, Promise<RobotsRules>>();

/**
 * Parser deliberadamente pequeño: `User-agent`, `Allow` y `Disallow`. No
 * implementa `Crawl-delay` porque ya vamos a 1 req/s, que es más conservador
 * que casi cualquier valor publicado.
 */
function parseRobots(text: string, userAgent: string): RobotsRules {
  const ua = userAgent.toLowerCase();
  const rules: RobotsRules = { disallow: [], allow: [] };

  let applies = false;
  let sawSpecific = false;
  const wildcard: RobotsRules = { disallow: [], allow: [] };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      const agent = value.toLowerCase();
      if (agent === "*") applies = false;
      else if (ua.includes(agent) || agent.includes("borsoga")) {
        applies = true;
        sawSpecific = true;
      } else applies = false;
      continue;
    }

    const target = applies ? rules : wildcard;
    if (field === "disallow" && value) target.disallow.push(value);
    else if (field === "allow" && value) target.allow.push(value);
  }

  return sawSpecific ? rules : wildcard;
}

async function fetchRobots(origin: string): Promise<RobotsRules> {
  const empty: RobotsRules = { disallow: [], allow: [] };
  try {
    await waitTurn(hostOf(origin));
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": config.CRAWL_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    // 404 o 5xx: no hay reglas publicadas, se puede rastrear.
    if (!res.ok) return empty;
    return parseRobots(await res.text(), config.CRAWL_USER_AGENT);
  } catch (err) {
    log.debug("robots.txt no disponible", { origin, err: String(err) });
    return empty;
  }
}

/** La regla más larga gana, que es lo que dice el estándar de facto. */
function longestMatch(patterns: string[], path: string): number {
  let best = -1;
  for (const p of patterns) {
    if (p === "/" || path.startsWith(p)) best = Math.max(best, p.length);
  }
  return best;
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  if (!config.CRAWL_RESPECT_ROBOTS) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const origin = parsed.origin;

  let rules = robotsCache.get(origin);
  if (!rules) {
    rules = fetchRobots(origin);
    robotsCache.set(origin, rules);
  }

  const { disallow, allow } = await rules;
  if (disallow.length === 0) return true;

  const path = parsed.pathname + parsed.search;
  const deny = longestMatch(disallow, path);
  if (deny < 0) return true;
  return longestMatch(allow, path) >= deny;
}

/** Descriptor legible del ritmo, para el panel de cumplimiento de la Traza. */
export const politenessSignals = {
  requestsPerSecond: config.CRAWL_REQUESTS_PER_SECOND,
  userAgent: config.CRAWL_USER_AGENT,
};
