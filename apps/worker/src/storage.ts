/**
 * Almacén de capturas. Devuelve un `storageKey` opaco que es lo que se guarda
 * en `evidence.screenshot_storage_key`; quien lo lea decide cómo servirlo.
 *
 * Solo el driver local por ahora. S3 entra cuando esto deje de correr en el
 * portátil de una persona — la interfaz ya está separada para que sea un
 * archivo nuevo y no un cambio en las herramientas.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { config } from "./config";

export interface StoredScreenshot {
  storageKey: string;
  width: number;
  height: number;
  takenAt: string;
}

/**
 * La raíz del almacén se ancla al repositorio, no al cwd.
 *
 * El worker corre desde `apps/worker` y la web desde `apps/web`, así que un
 * `./storage` relativo al cwd daba dos carpetas distintas: el worker escribía
 * capturas que la web no podía encontrar nunca. Anclando ambos a la raíz del
 * monorepo hay un solo almacén, que es lo que se quería decir.
 */
const root = resolve(process.cwd(), "../..", config.STORAGE_LOCAL_PATH);

/** Clave estable y sin datos del sistema de archivos del prospecto. */
function keyFor(scanId: string, url: string, width: number): string {
  const digest = createHash("sha256").update(`${url}·${width}`).digest("hex").slice(0, 16);
  return `screenshots/${scanId}/${digest}-${width}w.png`;
}

export async function saveScreenshot(args: {
  scanId: string;
  url: string;
  width: number;
  height: number;
  bytes: Buffer;
}): Promise<StoredScreenshot> {
  if (config.STORAGE_DRIVER !== "local") {
    throw new Error(`STORAGE_DRIVER=${config.STORAGE_DRIVER} no implementado todavía`);
  }

  const storageKey = keyFor(args.scanId, args.url, args.width);
  const path = join(root, storageKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, args.bytes);

  return {
    storageKey,
    width: args.width,
    height: args.height,
    takenAt: new Date().toISOString(),
  };
}
