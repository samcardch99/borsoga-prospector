/**
 * Superficie de herramientas del agente.
 *
 * Este array **es** la decisión de arquitectura del proyecto: la IA conduce el
 * proceso y decide qué mirar, y lo único que se le acota es qué puede mirar.
 * Cuando haga falta una comprobación nueva, se añade una herramienta aquí — no
 * un paso fijo antes del agente.
 *
 * Pendientes del contrato (`AgentToolName`), en orden de utilidad esperada:
 * `search_web` y `fetch_external_profile` —las dos necesitan credenciales de un
 * buscador—, `probe_contact_form` e `image_fingerprint`. El agente no las ve
 * hasta que existan, así que no puede prometer evidencia que nadie recogió.
 */

import type { AgentTool } from "@borsoga/shared";
import { renderDomTool, screenshotTool } from "./browser";
import { crawlSiteTool } from "./crawl";
import { fetchServedHtmlTool } from "./http";
import { lighthouseTool } from "./lighthouse";
import { searchMapsTool } from "./maps";
import { placesDetailsTool } from "./places";

/**
 * Las del descubrimiento. Van aparte de las del auditor porque el trabajo es
 * otro: aquí no se juzga un negocio, se busca cuáles hay.
 */
export const prospectorTools: readonly AgentTool<never>[] = [
  searchMapsTool,
] as readonly AgentTool<never>[];

export const auditorTools: readonly AgentTool<never>[] = [
  placesDetailsTool,
  fetchServedHtmlTool,
  renderDomTool,
  screenshotTool,
  crawlSiteTool,
  lighthouseTool,
] as readonly AgentTool<never>[];

export { closeBrowser } from "./browser";
