/**
 * `fetch_served_html`: el HTML tal cual lo devuelve el servidor.
 *
 * Es la mitad del par que el auditor necesita. Comparado con `render_dom`
 * responde a la pregunta que separa un problema de SEO de uno de contenido:
 * ¿el buscador ve lo mismo que la persona?
 */

import { z } from "zod";
import type { AgentTool, ToolResult } from "@borsoga/shared";
import { config } from "../config";
import { errorMessage } from "../log";
import { hostOf, isAllowedByRobots } from "../net/politeness";
import { clip, observe } from "./observation";

const inputSchema = {
  url: z.string().describe("URL absoluta a descargar, con esquema http o https"),
};

type Input = { url: string };

/** Texto visible aproximado, para poder citar sin arrastrar todo el markup. */
function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function metaSummary(html: string): Record<string, string | null> {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const description =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const viewport =
    /<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const ogImage =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null;
  return { title, description, viewport, ogImage, h1 };
}

export const fetchServedHtmlTool: AgentTool<Input> = {
  name: "fetch_served_html",
  description:
    "Descarga el HTML tal cual lo sirve el servidor, sin ejecutar JavaScript — lo que ve un buscador. " +
    "Devuelve estado, cabeceras relevantes, título, meta description, viewport, og:image, primer h1 " +
    "y el texto visible. Compáralo con render_dom para distinguir un problema de indexación de uno de contenido.",
  inputSchema,

  async run(input, ctx): Promise<ToolResult> {
    const { url } = input;

    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, errorCode: "BAD_URL", message: `URL no absoluta: ${url}` };
    }
    if (!(await isAllowedByRobots(url))) {
      return { ok: false, errorCode: "ROBOTS_DISALLOWED", message: `robots.txt prohíbe ${url}` };
    }

    await ctx.rateLimit(hostOf(url));

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "user-agent": config.CRAWL_USER_AGENT, accept: "text/html,*/*" },
        redirect: "follow",
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(config.CRAWL_TIMEOUT_MS)]),
      });
    } catch (err) {
      return { ok: false, errorCode: "FETCH_FAILED", message: errorMessage(err) };
    }

    const html = await res.text();
    const meta = metaSummary(html);
    const headers = {
      status: res.status,
      finalUrl: res.url,
      https: res.url.startsWith("https://"),
      contentType: res.headers.get("content-type"),
      server: res.headers.get("server"),
      xFrameOptions: res.headers.get("x-frame-options"),
      strictTransportSecurity: res.headers.get("strict-transport-security"),
    };

    const quote = [
      `HTTP ${res.status} ${res.url}`,
      `title: ${meta.title ?? "(ninguno)"}`,
      `description: ${meta.description ?? "(ninguna)"}`,
      `viewport: ${meta.viewport ?? "(ninguno)"}`,
      `h1: ${meta.h1 ?? "(ninguno)"}`,
      `og:image: ${meta.ogImage ?? "(ninguna)"}`,
      "",
      clip(textFromHtml(html), 2_500),
    ].join("\n");

    return {
      ok: true,
      summary:
        `HTTP ${res.status} · ${html.length} bytes de HTML · ` +
        `title=${meta.title ? "sí" : "no"} description=${meta.description ? "sí" : "no"} ` +
        `viewport=${meta.viewport ? "sí" : "no"}`,
      observations: [
        observe({
          tool: "fetch_served_html",
          url: res.url,
          quote,
          layer: "served_html",
          method: "curl · sin ejecutar JavaScript",
          raw: { ...headers, meta, htmlLength: html.length },
        }),
      ],
    };
  },
};
