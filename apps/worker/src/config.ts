/**
 * Configuración del worker. Se valida entera al arrancar y no a mitad de un
 * escaneo: un `GOOGLE_PLACES_API_KEY` vacío tiene que fallar antes de gastar
 * cuota, no después.
 */

import { z } from "zod";

const bool = z
  .string()
  .transform((v) => v === "true" || v === "1")
  .pipe(z.boolean());

const int = z.string().transform(Number).pipe(z.number().int().nonnegative());
const num = z.string().transform(Number).pipe(z.number().nonnegative());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  GOOGLE_PLACES_API_KEY: z.string().default(""),
  PLACES_MONTHLY_LIMIT: int.default(10_000),
  PLACES_CACHE_TTL_DAYS: int.default(30),

  LLM_PROVIDER: z.enum(["claude-code-local", "anthropic-api"]).default("claude-code-local"),
  ANTHROPIC_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default("claude-opus-5"),
  LLM_MAX_TURNS: int.default(40),

  /**
   * Deja que el auditor use la búsqueda web integrada del Agent SDK.
   *
   * Va contra la suscripción, no contra una API de terceros, así que no cuesta
   * dinero — pero sí engorda el prefijo del harness con la definición de la
   * herramienta. Es una bandera para poder medir la diferencia y decidir con
   * datos, no de memoria.
   */
  LLM_WEB_SEARCH: bool.default(true),
  /*
   * El tope por auditoría. A 2,5 se perdían informes enteros: el agente gastaba
   * el presupuesto y se quedaba sin entregar, y en una tanda de 25 prospectos
   * eso son varios perdidos. `crawl_site` y `lighthouse` devuelven mucho más
   * texto que las herramientas con las que se fijó esta cifra.
   */
  LLM_MAX_COST_USD_PER_PROSPECT: num.default(4),

  /**
   * El tope para buscar una zona entera. Es más alto que el de una auditoría
   * porque una búsqueda son varias llamadas a Maps y cada una devuelve una
   * lista larga, pero se gasta una vez por escaneo y no una por negocio.
   */
  LLM_MAX_COST_USD_PER_ZONE: num.default(6),

  WORKER_CONCURRENCY: int.default(2),
  WORKER_ID: z.string().default(`worker-${process.pid}`),
  WORKER_POLL_MS: int.default(2_000),

  /**
   * Cuántos prospectos audita como mucho un escaneo de zona.
   *
   * Es el freno de gasto del sistema. Sin él, `scan.zone` encola una auditoría
   * por cada negocio que devuelve Places, y cada auditoría puede llegar a
   * `LLM_MAX_COST_USD_PER_PROSPECT`: una zona con cien negocios se convierte en
   * una factura de tres cifras sin que nadie haya dicho que sí a eso.
   *
   * Los que sobran no se pierden: quedan guardados como prospectos sin auditar
   * y se pueden encolar a mano o subiendo este número a propósito.
   */
  SCAN_MAX_PROSPECTS: int.default(25),

  /**
   * Con qué agente de usuario se pide Google Maps.
   *
   * Aparte del resto del rastreo, y con un Chrome corriente por defecto, porque
   * con el agente propio del worker Maps no devuelve la lista. Va explícito y
   * con su motivo escrito, en vez de escondido dentro del raspador.
   */
  MAPS_USER_AGENT: z
    .string()
    .default(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    ),

  CRAWL_USER_AGENT: z.string().default("BorsogaProspector/0.1 (+https://borsoga.studio/bot)"),
  CRAWL_REQUESTS_PER_SECOND: num.default(1),
  CRAWL_MAX_PAGES_PER_SITE: int.default(25),
  CRAWL_RESPECT_ROBOTS: bool.default(true),
  CRAWL_TIMEOUT_MS: int.default(20_000),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

function load(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  return parsed.data;
}

export const config = load();

/**
 * Sin clave de Places no se puede escanear una zona, pero sí auditar un
 * prospecto que ya está en la base. Se comprueba donde hace falta y no al
 * arrancar, para que el worker siga sirviendo el resto de la cola.
 */
export function requirePlacesKey(): string {
  if (!config.GOOGLE_PLACES_API_KEY) {
    throw new Error("Falta GOOGLE_PLACES_API_KEY: no se puede escanear una zona.");
  }
  return config.GOOGLE_PLACES_API_KEY;
}
