/**
 * Prueba manual del raspado de Maps, sin cola ni base de datos.
 *
 * Existe porque lo que puede romperse aquí no es la lógica —eso ya lo cubren las
 * pruebas de `maps-parse`— sino Google: que cambie el DOM, que pida
 * consentimiento o que bloquee. Eso solo se comprueba pidiéndoselo de verdad.
 *
 *   pnpm --filter @borsoga/worker probe-maps "custom kitchen cabinets" 25.809 -80.355 8000 4
 */

import { closeBrowser } from "../tools/browser";
import { searchMaps } from "../tools/maps";

const [, , query, lat, lng, radius, limit] = process.argv;

try {
  const { cards, found } = await searchMaps({
    query: query ?? "custom kitchen cabinets",
    lat: Number(lat ?? 25.809),
    lng: Number(lng ?? -80.355),
    radiusMeters: Number(radius ?? 8_000),
    detailLimit: Number(limit ?? 4),
  });

  console.log(`${found} dentro del radio · ${cards.length} con ficha abierta`);
  for (const c of cards) {
    console.log(
      `- ${c.name} | ${c.category ?? "-"} | ${c.address ?? "-"} | ` +
        `${c.rating ?? "s/n"}★(${c.reviewCount ?? 0}) | ${c.website ?? "SIN WEB"} | ` +
        `${c.phone ?? "-"} | ${c.lat},${c.lng}`,
    );
  }
} finally {
  await closeBrowser();
}
