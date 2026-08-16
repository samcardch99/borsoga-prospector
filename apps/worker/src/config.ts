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
  LLM_MAX_COST_USD_PER_PROSPECT: num.default(2.5),

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
