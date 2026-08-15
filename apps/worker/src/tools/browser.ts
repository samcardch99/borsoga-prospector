/**
 * `render_dom` y `screenshot`: navegador real.
 *
 * Comparten un único Chromium para todo el proceso porque arrancarlo cuesta
 * más que la mayoría de las peticiones que hace el agente. Se cierra en el
 * apagado ordenado del worker.
 */

import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import type { AgentTool, ToolResult } from "@borsoga/shared";
import { config } from "../config";
import { errorMessage, log } from "../log";
import { hostOf, isAllowedByRobots } from "../net/politeness";
import { saveScreenshot } from "../storage";
import { clip, observe } from "./observation";

const DESKTOP = { width: 1440, height: 900 };

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (err) {
    log.warn("no se pudo cerrar Chromium", { err: errorMessage(err) });
  } finally {
    browserPromise = null;
  }
}

/** Página nueva en un contexto limpio: sin cookies heredadas entre prospectos. */
async function withPage<T>(
  width: number,
  height: number,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: config.CRAWL_USER_AGENT,
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

// ─── render_dom ──────────────────────────────────────────────────────────────

const renderInput = {
  url: z.string().describe("URL absoluta a abrir en el navegador"),
  width: z
    .number()
    .int()
    .min(320)
    .max(2560)
    .optional()
    .describe("Ancho del viewport en px. 1440 por defecto; usa 390 para ver el móvil"),
};

type RenderInput = { url: string; width?: number };

export const renderDomTool: AgentTool<RenderInput> = {
  name: "render_dom",
  description:
    "Abre la URL en un Chromium real, espera a que la red se calme y devuelve el DOM ya renderizado: " +
    "texto visible, número de imágenes sin alt, enlaces, errores de consola y peticiones fallidas. " +
    "Es lo que ve una persona. Compáralo con fetch_served_html para detectar contenido que solo existe tras ejecutar JS.",
  inputSchema: renderInput,

  async run(input, ctx): Promise<ToolResult> {
    const { url } = input;
    const width = input.width ?? DESKTOP.width;

    if (!(await isAllowedByRobots(url))) {
      return { ok: false, errorCode: "ROBOTS_DISALLOWED", message: `robots.txt prohíbe ${url}` };
    }
    await ctx.rateLimit(hostOf(url));

    try {
      const result = await withPage(width, DESKTOP.height, async (page) => {
        const consoleErrors: string[] = [];
        const failedRequests: string[] = [];
        page.on("console", (m) => {
          if (m.type() === "error") consoleErrors.push(clip(m.text(), 300));
        });
        page.on("requestfailed", (r) => {
          failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "?"}`);
        });

        const response = await page.goto(url, {
          waitUntil: "networkidle",
          timeout: config.CRAWL_TIMEOUT_MS,
        });

        const facts = await page.evaluate(() => {
          const imgs = Array.from(document.images);
          const links = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
          return {
            title: document.title,
            text: document.body?.innerText ?? "",
            images: imgs.length,
            imagesWithoutAlt: imgs.filter((i) => !i.alt?.trim()).length,
            links: links.length,
            externalLinks: links.filter((a) => {
              try {
                return new URL(a.href).host !== location.host;
              } catch {
                return false;
              }
            }).length,
            forms: document.querySelectorAll("form").length,
            hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
            scrollHeight: document.documentElement.scrollHeight,
          };
        });

        return { status: response?.status() ?? 0, finalUrl: page.url(), facts, consoleErrors, failedRequests };
      });

      const quote = [
        `DOM renderizado · HTTP ${result.status} · ${result.finalUrl}`,
        `title: ${result.facts.title || "(ninguno)"}`,
        `imágenes: ${result.facts.images} (sin alt: ${result.facts.imagesWithoutAlt})`,
        `enlaces: ${result.facts.links} (externos: ${result.facts.externalLinks}) · formularios: ${result.facts.forms}`,
        `errores de consola: ${result.consoleErrors.length} · peticiones fallidas: ${result.failedRequests.length}`,
        "",
        clip(result.facts.text, 2_500),
      ].join("\n");

      return {
        ok: true,
        summary:
          `DOM de ${result.finalUrl} · ${result.facts.images} imágenes ` +
          `(${result.facts.imagesWithoutAlt} sin alt) · ${result.consoleErrors.length} errores de consola`,
        observations: [
          observe({
            tool: "render_dom",
            url: result.finalUrl,
            quote,
            layer: "rendered_dom",
            method: `navegador real · ${width}×${DESKTOP.height}`,
            raw: {
              status: result.status,
              ...result.facts,
              text: undefined,
              consoleErrors: result.consoleErrors.slice(0, 20),
              failedRequests: result.failedRequests.slice(0, 20),
            },
          }),
        ],
      };
    } catch (err) {
      return { ok: false, errorCode: "RENDER_FAILED", message: errorMessage(err) };
    }
  },
};

// ─── screenshot ──────────────────────────────────────────────────────────────

const shotInput = {
  url: z.string().describe("URL absoluta a capturar"),
  width: z
    .number()
    .int()
    .min(320)
    .max(2560)
    .optional()
    .describe("Ancho del viewport en px. 1440 por defecto; 390 para el móvil"),
  fullPage: z.boolean().optional().describe("Capturar la página entera y no solo el primer pantallazo"),
};

type ShotInput = { url: string; width?: number; fullPage?: boolean };

export const screenshotTool: AgentTool<ShotInput> = {
  name: "screenshot",
  description:
    "Captura la página a un ancho dado y guarda la imagen junto a la evidencia. Úsala cuando el hallazgo " +
    "sea visual (diseño desactualizado, móvil roto, imágenes de banco) y quieras que aparezca en la propuesta.",
  inputSchema: shotInput,

  async run(input, ctx): Promise<ToolResult> {
    const { url } = input;
    const width = input.width ?? DESKTOP.width;
    const fullPage = input.fullPage ?? false;

    if (!(await isAllowedByRobots(url))) {
      return { ok: false, errorCode: "ROBOTS_DISALLOWED", message: `robots.txt prohíbe ${url}` };
    }
    await ctx.rateLimit(hostOf(url));

    try {
      const { bytes, finalUrl, height, title } = await withPage(
        width,
        DESKTOP.height,
        async (page) => {
          await page.goto(url, { waitUntil: "networkidle", timeout: config.CRAWL_TIMEOUT_MS });
          const buffer = await page.screenshot({ fullPage, type: "png" });
          const pageHeight = fullPage
            ? await page.evaluate(() => document.documentElement.scrollHeight)
            : DESKTOP.height;
          return {
            bytes: buffer,
            finalUrl: page.url(),
            height: pageHeight,
            title: await page.title(),
          };
        },
      );

      const stored = await saveScreenshot({ scanId: ctx.scanId, url, width, height, bytes });

      return {
        ok: true,
        summary: `Captura guardada (${width}×${height}${fullPage ? ", página completa" : ""})`,
        observations: [
          observe({
            tool: "screenshot",
            url: finalUrl,
            quote: `Captura de ${finalUrl} a ${width}×${height} px. Título de la página: ${title || "(ninguno)"}.`,
            layer: "rendered_dom",
            method: `navegador real · ${width}×${height}`,
            screenshot: stored,
            raw: { storageKey: stored.storageKey, fullPage },
          }),
        ],
      };
    } catch (err) {
      return { ok: false, errorCode: "SCREENSHOT_FAILED", message: errorMessage(err) };
    }
  },
};
