/**
 * Sirve las capturas de evidencia que guardó el worker.
 *
 * El worker escribe en disco y deja en `evidence.screenshot_storage_key` una
 * clave opaca; quien la lea decide cómo servirla (ver `apps/worker/src/storage.ts`).
 * Esto es ese "cómo" para el driver local.
 *
 * No se sirven desde `public/`: son datos de auditoría de un prospecto, no
 * assets del producto, y su ciclo de vida es el del escaneo, no el del build.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

/** Misma raíz que el worker: anclada al repositorio, no al cwd. */
const ROOT = resolve(process.cwd(), "../..", process.env.STORAGE_LOCAL_PATH ?? "./storage");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;

  /*
   * La clave viene de la URL, así que se trata como entrada hostil aunque la
   * haya escrito el worker: se normaliza y se comprueba que el resultado sigue
   * dentro de la raíz. Sin esto, un `..%2f..%2f` serviría cualquier archivo de
   * la máquina.
   */
  const requested = normalize(join(ROOT, ...key.map(decodeURIComponent)));
  if (requested !== ROOT && !requested.startsWith(ROOT + sep)) {
    return new Response("Ruta no permitida", { status: 403 });
  }

  let size: number;
  try {
    const info = await stat(requested);
    if (!info.isFile()) return new Response("No encontrada", { status: 404 });
    size = info.size;
  } catch {
    return new Response("No encontrada", { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(requested)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "content-type": "image/png",
      "content-length": String(size),
      // La clave lleva un hash del contenido, así que el archivo es inmutable.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
