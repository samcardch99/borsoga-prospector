/**
 * "Exportar JSON" del pie de la lista (handoff §6.1).
 *
 * Devuelve exactamente lo que la lista está mostrando — mismos filtros, mismo
 * orden — y no todo lo que hay en la base. Si el botón exportara otra cosa que
 * lo que se ve en pantalla, el fichero no serviría para discutir la lista con
 * nadie, que es para lo que se exporta.
 */

import { getZone, listProspects } from "@/lib/queries";
import { applyFilters, type ListFilter } from "@/components/map/prospect-list";

export const dynamic = "force-dynamic";

const VALID_FILTERS: readonly ListFilter[] = ["icp", "nuevo", "desc"];

export async function GET(request: Request) {
  const url = new URL(request.url);

  const zone = await getZone(url.searchParams.get("zona") ?? undefined);
  if (!zone) {
    return Response.json({ error: "No hay ninguna zona configurada" }, { status: 404 });
  }

  const raw = url.searchParams.get("f") ?? "";
  const filters = new Set(
    raw.split(",").filter((p): p is ListFilter => (VALID_FILTERS as readonly string[]).includes(p)),
  );

  const rows = applyFilters(await listProspects(zone.id), filters);

  const body = JSON.stringify(
    {
      zone: { id: zone.id, name: zone.name },
      filters: [...filters],
      exportedAt: new Date().toISOString(),
      count: rows.length,
      prospects: rows,
    },
    null,
    2,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = zone.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="prospectos-${slug || "zona"}-${stamp}.json"`,
    },
  });
}
