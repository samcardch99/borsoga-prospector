/**
 * Cola de revisión (handoff §6.3). Paso 6 del orden de construcción.
 *
 * La IA propone `pending` y aquí un humano decide. Es la pantalla que hace que
 * el resto del sistema sea defendible: sin revisión, un hallazgo confirmado y
 * uno inventado valdrían lo mismo delante de un cliente.
 */

import {
  getNavCounts,
  getQuota,
  getReviewedToday,
  getZone,
  listReviewQueue,
  type ReviewFilter,
} from "@/lib/queries";
import { AppHeader } from "@/components/shell/app-header";
import { TabBar } from "@/components/shell/tab-bar";
import { ReviewDesk } from "@/components/revision/review-desk";

export const dynamic = "force-dynamic";

const FILTERS: readonly ReviewFilter[] = ["pendientes", "matizados", "todos"];

function parseFilter(raw: string | string[] | undefined): ReviewFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return FILTERS.includes(value as ReviewFilter) ? (value as ReviewFilter) : "pendientes";
}

export default async function RevisionPage({ searchParams }: PageProps<"/revision">) {
  const sp = await searchParams;
  const filter = parseFilter(sp.f);

  const [items, reviewedToday, zone, quota, navCounts] = await Promise.all([
    listReviewQueue(filter),
    getReviewedToday(),
    getZone(),
    getQuota(),
    getNavCounts(),
  ]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader zone={zone} quota={quota} />
      <TabBar counts={navCounts} lastScanLabel={null} />
      <ReviewDesk items={items} filter={filter} reviewedToday={reviewedToday} />
    </div>
  );
}
