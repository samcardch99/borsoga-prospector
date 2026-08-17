/** Prueba directa de las herramientas nuevas. Sin LLM. */
import type { AgentToolContext } from "@borsoga/shared";
import { waitTurn } from "./src/net/politeness";
import { crawlSiteTool } from "./src/tools/crawl";
import { lighthouseTool } from "./src/tools/lighthouse";

const ctx: AgentToolContext = {
  scanId: "prueba",
  prospectId: "prueba",
  signal: AbortSignal.timeout(240_000),
  rateLimit: waitTurn,
};

async function main(): Promise<void> {
  console.log("── crawl_site ──────────────────────────────");
  const t0 = Date.now();
  const crawl = await crawlSiteTool.run({ startUrl: "https://borsogastudio.com/", maxPages: 8 }, ctx);
  console.log(`ok=${crawl.ok} · ${Math.round((Date.now() - t0) / 1000)}s`);
  if (crawl.ok) {
    console.log("resumen:", crawl.summary);
    console.log((crawl.observations?.[0]?.quote ?? "").split("\n").slice(0, 14).join("\n"));
  } else {
    console.log("error:", crawl.errorCode, crawl.message);
  }

  console.log("\n── lighthouse ──────────────────────────────");
  const t1 = Date.now();
  const lh = await lighthouseTool.run({ url: "https://borsogastudio.com/" }, ctx);
  console.log(`ok=${lh.ok} · ${Math.round((Date.now() - t1) / 1000)}s`);
  if (lh.ok) {
    console.log("resumen:", lh.summary);
    console.log((lh.observations?.[0]?.quote ?? "").split("\n").slice(0, 16).join("\n"));
  } else {
    console.log("error:", lh.errorCode, lh.message);
  }
}

void main();
