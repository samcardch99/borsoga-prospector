import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

/*
 * El .env vive en la raíz del monorepo, no aquí. Next solo mira el directorio
 * de la aplicación, así que sin esto `DATABASE_URL` no llega y el cliente de
 * Postgres revienta al importarse — con un error que apunta a la base de datos
 * y no a la configuración, que es lo que cuesta encontrar.
 *
 * Un único .env en la raíz, compartido con el worker, es lo que describe el
 * README; duplicarlo en apps/web sería una segunda copia que se desincroniza.
 *
 * `loadEnvFile` es de Node 22 (el `engines` del repo ya lo exige) y no pisa lo
 * que ya venga del entorno, así que en producción mandan las variables reales.
 */
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const nextConfig: NextConfig = {
  /*
   * Drizzle y postgres-js solo tienen sentido en el servidor. Marcarlos como
   * externos evita que el bundler intente empaquetar el driver.
   */
  serverExternalPackages: ["postgres", "drizzle-orm"],
};

export default nextConfig;
