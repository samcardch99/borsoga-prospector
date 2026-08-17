/**
 * Nombre, web y teléfono de los prospectos, leídos de la tabla.
 *
 * Existe porque medí este dato durante horas contra `/api/prospects`, que no
 * devuelve `website` — así que todo salía vacío y parecía un fallo de guardado
 * que no existía. Una regla sin la marca que buscas no dice "no sé": dice cero.
 */

import { desc } from "drizzle-orm";
import { db, pgClient, prospects } from "@borsoga/db";

try {
  const rows = await db
    .select({
      name: prospects.name,
      website: prospects.website,
      phone: prospects.phone,
      lat: prospects.lat,
      lng: prospects.lng,
    })
    .from(prospects)
    .orderBy(desc(prospects.firstSeenAt))
    .limit(Number(process.argv[2] ?? 12));

  const conWeb = rows.filter((r) => r.website).length;
  console.log(`${conWeb} con web de ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  ${r.name.slice(0, 34).padEnd(36)} ${r.website ?? "—"}  ${r.phone ?? "—"}  ${r.lat},${r.lng}`,
    );
  }
} finally {
  await pgClient.end({ timeout: 5 });
}
