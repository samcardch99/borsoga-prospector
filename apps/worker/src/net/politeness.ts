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
import { parseRobots, type RobotsRules } from "./robots";
import { log } from "../log";

const minIntervalMs = Math.ceil(1000 / Math.max(config.CRAWL_REQUESTS_PER_SECOND, 0.01));

/** Última salida programada por dominio. Encolar es sumar, no dormir a ojo. */
const nextSlot = new Map<string, number>();

/**
 * Intervalo pedido por cada dominio en su `Crawl-delay`, si pide más que el
 * nuestro. Se rellena al leer su robots.txt.
 */
const crawlDelayMs = new Map<string, number>();

/** robots.txt ya leído por origen. Una vez por sitio, no una por página. */
const robotsCache = new Map<string, Promise<RobotsRules>>();

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
  // El que pida más espera manda: el nuestro o el del sitio.
  const interval = Math.max(minIntervalMs, crawlDelayMs.get(domain) ?? 0);
  const slot = Math.max(now, nextSlot.get(domain) ?? 0);
  nextSlot.set(domain, slot + interval);
  const delay = slot - now;
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
}

/** El ritmo real que se está aplicando a un dominio, para la Traza. */
export function effectiveRequestsPerSecond(domain: string): number {
  const interval = Math.max(minIntervalMs, crawlDelayMs.get(domain) ?? 0);
  return Number((1000 / interval).toFixed(3));
}

// ─── robots.txt ──────────────────────────────────────────────────────────────

async function fetchRobots(origin: string): Promise<RobotsRules> {
  const empty: RobotsRules = { disallow: [], allow: [], crawlDelaySeconds: null };
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

  const { disallow, allow, crawlDelaySeconds } = await rules;

  if (crawlDelaySeconds !== null) {
    crawlDelayMs.set(parsed.host, crawlDelaySeconds * 1000);
  }

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
