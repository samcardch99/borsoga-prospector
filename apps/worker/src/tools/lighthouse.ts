/**
 * `lighthouse`: rendimiento, accesibilidad, SEO y buenas prácticas de una URL.
 *
 * Se usa Lighthouse de verdad y no una medición propia con la Performance API,
 * porque el número que sale de aquí acaba en una propuesta que alguien lee. "Un
 * 34 en rendimiento según Lighthouse" es una frase que el cliente puede
 * comprobar por su cuenta en dos minutos; "hemos medido que va lento" no.
 *
 * Lanza su propio Chrome en vez de reutilizar el navegador de las otras
 * herramientas: Lighthouse necesita una sesión limpia —sin caché ni cookies de
 * visitas anteriores— o las métricas de carga salen mejores de lo que serían
 * para alguien que llega por primera vez, que es justo la persona que importa.
 * Reutiliza el Chromium que ya instaló Playwright, así que no descarga nada.
 */

import { chromium } from "playwright";
import { z } from "zod";
import type { AgentTool, ToolResult } from "@borsoga/shared";
import { errorMessage } from "../log";
import { hostOf, isAllowedByRobots } from "../net/politeness";
import { observe } from "./observation";

const inputSchema = {
  url: z.string().describe("URL absoluta a auditar"),
  formFactor: z
    .enum(["mobile", "desktop"])
    .optional()
    .describe("Móvil por defecto: es como llega la mayoría del tráfico"),
};

type Input = { url: string; formFactor?: "mobile" | "desktop" };

/** Categorías del informe, con el nombre que se enseña. */
const CATEGORIES: Array<[key: string, label: string]> = [
  ["performance", "Rendimiento"],
  ["accessibility", "Accesibilidad"],
  ["best-practices", "Buenas prácticas"],
  ["seo", "SEO"],
];

/** Métricas que se citan tal cual; el resto del informe es ruido para esto. */
const METRICS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
];

function pct(score: number | null | undefined): string {
  return score === null || score === undefined ? "—" : String(Math.round(score * 100));
}

export const lighthouseTool: AgentTool<Input> = {
  name: "lighthouse",
  description:
    "Pasa Lighthouse a una URL y devuelve las cuatro puntuaciones (rendimiento, accesibilidad, " +
    "buenas prácticas, SEO) sobre 100, las métricas de carga (LCP, FCP, TBT, CLS, Speed Index) y " +
    "las auditorías que ha suspendido, con su descripción. Por defecto mide en móvil. " +
    "Tarda entre 20 y 60 segundos: úsalo una vez por sitio, no por página.",
  inputSchema,

  async run(input, ctx): Promise<ToolResult> {
    const { url } = input;
    const formFactor = input.formFactor ?? "mobile";

    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, errorCode: "BAD_URL", message: `URL no absoluta: ${url}` };
    }
    if (!(await isAllowedByRobots(url))) {
      return { ok: false, errorCode: "ROBOTS_DISALLOWED", message: `robots.txt prohíbe ${url}` };
    }

    await ctx.rateLimit(hostOf(url));

    /* Import diferido: Lighthouse y chrome-launcher son pesados y arrastran su
       propio árbol. Cargarlos al arrancar el worker retrasaría el arranque
       incluso en runs donde el agente no llega a usar esta herramienta. */
    const [{ default: lighthouse }, chromeLauncher] = await Promise.all([
      import("lighthouse"),
      import("chrome-launcher"),
    ]);

    let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | null = null;

    try {
      chrome = await chromeLauncher.launch({
        chromePath: chromium.executablePath(),
        chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
      });

      const result = await lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        formFactor,
        screenEmulation:
          formFactor === "desktop"
            ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
            : undefined,
      });

      if (!result?.lhr) {
        return { ok: false, errorCode: "NO_REPORT", message: "Lighthouse no devolvió informe" };
      }

      const lhr = result.lhr;

      if (lhr.runtimeError) {
        return {
          ok: false,
          errorCode: lhr.runtimeError.code ?? "RUNTIME_ERROR",
          message: lhr.runtimeError.message,
        };
      }

      const scores = CATEGORIES.map(([key, label]) => ({
        key,
        label,
        score: lhr.categories[key]?.score ?? null,
      }));

      const metrics = METRICS.map((id) => ({
        id,
        title: lhr.audits[id]?.title ?? id,
        display: lhr.audits[id]?.displayValue ?? "—",
      }));

      /* Solo las auditorías suspendidas y con peso. Un informe entero son
         cientos de entradas y el agente no necesita las que ya pasan. */
      const failed = Object.values(lhr.audits)
        .filter(
          (a) =>
            a.score !== null &&
            a.score !== undefined &&
            a.score < 0.9 &&
            a.scoreDisplayMode !== "notApplicable" &&
            a.scoreDisplayMode !== "informative",
        )
        .slice(0, 20)
        .map((a) => `- [${pct(a.score)}] ${a.title}${a.displayValue ? ` (${a.displayValue})` : ""}`);

      const quote = [
        `Lighthouse ${lhr.lighthouseVersion} · ${formFactor} · ${lhr.finalDisplayedUrl}`,
        "",
        ...scores.map((s) => `${s.label}: ${pct(s.score)}/100`),
        "",
        "Métricas de carga:",
        ...metrics.map((m) => `- ${m.title}: ${m.display}`),
        "",
        `Auditorías suspendidas (${failed.length} mostradas):`,
        ...failed,
      ].join("\n");

      const perf = pct(lhr.categories.performance?.score);
      const seo = pct(lhr.categories.seo?.score);
      const a11y = pct(lhr.categories.accessibility?.score);

      return {
        ok: true,
        summary: `rendimiento ${perf} · accesibilidad ${a11y} · SEO ${seo} (${formFactor})`,
        observations: [
          observe({
            tool: "lighthouse",
            url: lhr.finalDisplayedUrl,
            quote,
            layer: "rendered_dom",
            method: `Lighthouse ${lhr.lighthouseVersion} · ${formFactor} · Chrome headless limpio`,
            raw: {
              formFactor,
              scores: Object.fromEntries(scores.map((s) => [s.key, s.score])),
              metrics: Object.fromEntries(metrics.map((m) => [m.id, m.display])),
              failedCount: failed.length,
            },
          }),
        ],
      };
    } catch (err) {
      return { ok: false, errorCode: "LIGHTHOUSE_FAILED", message: errorMessage(err) };
    } finally {
      await chrome?.kill();
    }
  },
};
