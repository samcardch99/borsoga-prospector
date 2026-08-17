/** Vuelca la cita de la última observación de `search_maps`. Depuración. */
import { desc, eq } from "drizzle-orm";
import { db, pgClient, traceSteps } from "@borsoga/db";

try {
  const rows = await db
    .select({ output: traceSteps.output })
    .from(traceSteps)
    .where(eq(traceSteps.step, "search_maps"))
    .orderBy(desc(traceSteps.startedAt))
    .limit(10);

  for (const row of rows) {
    const obs = (row.output as { observations?: Array<{ quote?: string }> } | null)?.observations;
    const quote = obs?.[0]?.quote;
    if (quote) {
      console.log(quote.split("\n").slice(0, 10).join("\n"));
      break;
    }
  }
} finally {
  await pgClient.end({ timeout: 5 });
}
