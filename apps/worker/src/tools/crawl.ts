/**
 * `crawl_site`: recorrer el sitio siguiendo sus propios enlaces.
 *
 * Hasta ahora el agente solo podía mirar la portada, y casi todo lo que se le
 * vende a un estudio de arquitectura está en las páginas de proyecto: es ahí
 * donde hay títulos repetidos, enlaces rotos y fichas sin texto. Una auditoría
 * que solo mira la home encuentra los problemas de la home.
 *
 * Buena vecindad, que aquí no es una nota al pie sino el límite del recorrido
 * (handoff §10.3): robots.txt antes de cada página, una petición por segundo y
 * por dominio, y un tope duro de páginas. El tope se aplica aunque el agente
 * pida más — quien decide cuánto se puede rascar un sitio ajeno no es el
 * modelo.
 */

import { z } from "zod";
import type { AgentTool, ToolResult } from "@borsoga/shared";
import { config } from "../config";
import { errorMessage } from "../log";
import { hostOf, isAllowedByRobots } from "../net/politeness";
import { clip, observe } from "./observation";

const inputSchema = {
  startUrl: z.string().describe("URL absoluta por la que empezar, normalmente la portada"),
  maxPages: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Páginas como mucho. Se recorta al tope del worker aunque pidas más"),
};

type Input = { startUrl: string; maxPages?: number };

interface Page {
  url: string;
  status: number;
  title: string | null;
  h1: string | null;
  description: string | null;
  words: number;
  /** Desde qué página se llegó. Sirve para explicar un enlace roto. */
  from: string | null;
}

/** Extensiones que no son páginas: no aportan y gastan cuota del recorrido. */
const SKIP = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|zip|mp4|webm|woff2?|ttf)(\?|$)/i;

function linksFrom(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const raw = match[1];
    if (!raw || /^(mailto:|tel:|javascript:|#)/i.test(raw)) continue;

    try {
      const url = new URL(raw, base);
      url.hash = "";
      if (!/^https?:$/.test(url.protocol)) continue;
      if (SKIP.test(url.pathname)) continue;
      out.push(url.toString());
    } catch {
      // href que no es una URL válida. Es en sí un hallazgo posible, pero no
      // se sigue: lo que interesa aquí es el recorrido.
    }
  }

  return out;
}

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(html: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(html);
  return m?.[1]?.replace(/<[^>]+>/g, "").trim() || null;
}

export const crawlSiteTool: AgentTool<Input> = {
  name: "crawl_site",
  description:
    "Recorre el sitio siguiendo sus enlaces internos, respetando robots.txt y una petición por segundo. " +
    "Devuelve, por página, su estado HTTP, título, h1, meta description y número de palabras, más un " +
    "resumen de enlaces rotos, títulos duplicados y páginas sin descripción. Úsalo cuando necesites " +
    "saber cómo está el sitio entero y no solo la portada.",
  inputSchema,

  async run(input, ctx): Promise<ToolResult> {
    const { startUrl } = input;

    if (!/^https?:\/\//i.test(startUrl)) {
      return { ok: false, errorCode: "BAD_URL", message: `URL no absoluta: ${startUrl}` };
    }

    let origin: string;
    try {
      origin = new URL(startUrl).origin;
    } catch {
      return { ok: false, errorCode: "BAD_URL", message: `URL ilegible: ${startUrl}` };
    }

    const limit = Math.min(input.maxPages ?? config.CRAWL_MAX_PAGES_PER_SITE, config.CRAWL_MAX_PAGES_PER_SITE);

    const queue: Array<{ url: string; from: string | null }> = [{ url: startUrl, from: null }];
    const seen = new Set<string>([startUrl]);
    const pages: Page[] = [];
    let blockedByRobots = 0;

    while (queue.length > 0 && pages.length < limit) {
      const next = queue.shift();
      if (!next) break;
      if (ctx.signal.aborted) break;

      if (!(await isAllowedByRobots(next.url))) {
        blockedByRobots += 1;
        continue;
      }

      await ctx.rateLimit(hostOf(next.url));

      let res: Response;
      try {
        res = await fetch(next.url, {
          headers: { "user-agent": config.CRAWL_USER_AGENT, accept: "text/html,*/*" },
          redirect: "follow",
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(config.CRAWL_TIMEOUT_MS)]),
        });
      } catch (err) {
        pages.push({
          url: next.url,
          status: 0,
          title: null,
          h1: null,
          description: null,
          words: 0,
          from: next.from,
        });
        void errorMessage(err);
        continue;
      }

      const isHtml = (res.headers.get("content-type") ?? "").includes("text/html");
      const html = isHtml ? await res.text() : "";

      pages.push({
        url: res.url,
        status: res.status,
        title: tagText(html, "title"),
        h1: tagText(html, "h1"),
        description:
          /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null,
        words: html ? textOf(html).split(" ").filter(Boolean).length : 0,
        from: next.from,
      });

      // Solo se siguen enlaces de páginas que respondieron bien y del mismo
      // origen: un crawler que salta a otro dominio deja de ser una auditoría.
      if (res.ok && isHtml) {
        for (const link of linksFrom(html, res.url)) {
          if (seen.size >= limit * 4) break;
          if (!link.startsWith(origin) || seen.has(link)) continue;
          seen.add(link);
          queue.push({ url: link, from: res.url });
        }
      }
    }

    if (pages.length === 0) {
      return { ok: false, errorCode: "NOTHING_CRAWLED", message: `no se pudo recorrer ${startUrl}` };
    }

    const broken = pages.filter((p) => p.status === 0 || p.status >= 400);
    const noDescription = pages.filter((p) => p.status < 400 && p.status > 0 && !p.description);
    const noTitle = pages.filter((p) => p.status < 400 && p.status > 0 && !p.title);

    const byTitle = new Map<string, number>();
    for (const p of pages) {
      if (!p.title) continue;
      byTitle.set(p.title, (byTitle.get(p.title) ?? 0) + 1);
    }
    const duplicatedTitles = [...byTitle.entries()].filter(([, n]) => n > 1);

    const table = pages
      .map(
        (p) =>
          `${String(p.status).padStart(3)} ${p.url}\n` +
          `    title: ${p.title ?? "(ninguno)"}\n` +
          `    h1: ${p.h1 ?? "(ninguno)"} · description: ${p.description ? "sí" : "no"} · ${p.words} palabras` +
          (p.from && (p.status === 0 || p.status >= 400) ? `\n    enlazada desde ${p.from}` : ""),
      )
      .join("\n");

    const quote = [
      `Recorrido de ${origin} · ${pages.length} páginas · tope ${limit}`,
      `enlaces rotos: ${broken.length}`,
      `sin meta description: ${noDescription.length}`,
      `sin title: ${noTitle.length}`,
      `títulos duplicados: ${duplicatedTitles.length}`,
      blockedByRobots > 0 ? `bloqueadas por robots.txt: ${blockedByRobots}` : null,
      "",
      clip(table, 4_000),
    ]
      .filter((l) => l !== null)
      .join("\n");

    return {
      ok: true,
      summary:
        `${pages.length} páginas · ${broken.length} rotas · ` +
        `${noDescription.length} sin description · ${duplicatedTitles.length} títulos duplicados`,
      observations: [
        observe({
          tool: "crawl_site",
          url: startUrl,
          quote,
          layer: "served_html",
          method: `recorrido · ${pages.length} páginas · 1 req/s · robots.txt respetado`,
          raw: {
            pages,
            broken: broken.map((p) => ({ url: p.url, status: p.status, from: p.from })),
            duplicatedTitles,
            blockedByRobots,
          },
        }),
      ],
    };
  },
};
