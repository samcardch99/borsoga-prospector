/**
 * `search_maps`: descubrir negocios raspando Google Maps con un navegador real.
 *
 * Es la alternativa a la API de Places, y existe porque Places obliga a dar de
 * alta una cuenta de facturación para algo que ya se estaba haciendo a mano con
 * un navegador. Lo que hace esta herramienta es exactamente eso, pero registrado
 * paso a paso en la Traza en vez de perderse en una conversación.
 *
 * Tres cosas que conviene saber antes de tocarla:
 *
 * 1. **Va contra los términos de servicio de Google.** Es una decisión tomada
 *    con conocimiento, para un volumen pequeño (unas decenas de fichas por
 *    escaneo) y sobre datos públicos de empresas. Google bloquea a quien insiste
 *    demasiado; si aparece un CAPTCHA la herramienta se rinde y lo dice, y no lo
 *    intenta resolver.
 * 2. **Se presenta como un Chrome normal.** Con el agente de usuario propio del
 *    worker, Maps ni siquiera devuelve la lista. Es el precio de la decisión
 *    anterior; queda escrito aquí y no escondido en un valor por defecto.
 * 3. **La tarjeta del listado no trae la web**, que es justo lo que el auditor
 *    necesita. Hay que abrir la ficha de cada negocio, y por eso el número de
 *    fichas que se abren es un tope explícito y no "todas las que salgan".
 *
 * Lo mecánico está aquí; interpretar el texto de cada tarjeta está en
 * `maps-parse.ts`, con pruebas sobre capturas reales del DOM.
 */

import { z } from "zod";
import { distanceMeters, zoomForRadius } from "@borsoga/shared";
import type { AgentTool, ToolResult } from "@borsoga/shared";
import { config } from "../config";
import { errorMessage, log } from "../log";
import { withPage } from "./browser";
import { observe } from "./observation";
import { toCard, type MapsCard, type RawCard } from "./maps-parse";

const VIEWPORT = { width: 1440, height: 1000 };

/** Ancho del panel de resultados de Maps, para calcular un zoom razonable. */
const FEED_PX = 400;

export class MapsBlocked extends Error {
  constructor(readonly code: "BLOCKED" | "CONSENT_WALL") {
    super(
      code === "BLOCKED"
        ? "Google devolvió una comprobación anti-bot. No se resuelve automáticamente."
        : "Google se quedó en la pantalla de consentimiento y no dio paso al mapa.",
    );
    this.name = "MapsBlocked";
  }
}

function searchUrl(query: string, lat: number, lng: number, radiusMeters: number): string {
  const zoom = Math.round(zoomForRadius(lat, radiusMeters, FEED_PX));
  // `hl=en` fija el idioma del texto que se va a parsear. Ver `maps-parse.ts`.
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}/@${lat},${lng},${zoom}z?hl=en`;
}

/**
 * La pantalla de consentimiento de Google, resuelta por la opción que menos
 * datos cede. No es una concesión: rechazar todo lo no esencial da paso al mapa
 * igual que aceptar, así que no hay ningún motivo para aceptar.
 */
async function passConsent(page: import("playwright").Page): Promise<void> {
  if (!/consent\.google\.|\/sorry\//.test(page.url())) return;

  const reject = page
    .locator('button:has-text("Reject all"), button[aria-label*="Reject all"]')
    .first();

  if ((await reject.count()) > 0) {
    await reject.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
  }
}

/** Si Google enseña su comprobación anti-bot, se abandona. No se resuelve. */
function assertNotBlocked(url: string): void {
  if (/\/sorry\//.test(url)) throw new MapsBlocked("BLOCKED");
  if (/consent\.google\./.test(url)) throw new MapsBlocked("CONSENT_WALL");
}

/**
 * El listado carga por desplazamiento, no por paginación. Se baja hasta que
 * deja de crecer dos veces seguidas — una sola vez se queda corto, porque la
 * carga es asíncrona y un tirón puede llegar a destiempo.
 */
async function scrollFeed(page: import("playwright").Page, want: number): Promise<number> {
  let quiet = 0;
  let seen = 0;

  for (let i = 0; i < 25 && quiet < 2; i += 1) {
    const count = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return 0;
      feed.scrollTop = feed.scrollHeight;
      return feed.querySelectorAll('a[href*="/maps/place/"]').length;
    });

    quiet = count > seen ? 0 : quiet + 1;
    seen = count;
    if (seen >= want) break;

    await page.waitForTimeout(1_200);
  }

  return seen;
}

/** Saca de cada tarjeta lo justo: nombre, enlace y texto. Interpretar es aparte. */
async function readCards(page: import("playwright").Page): Promise<RawCard[]> {
  return page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return [];

    return Array.prototype.flatMap.call(Array.from(feed.children), (card: Element) => {
      const link = card.querySelector('a[href*="/maps/place/"]');
      if (!link) return [];
      return [
        {
          name: link.getAttribute("aria-label") ?? "",
          href: link.getAttribute("href") ?? "",
          text: (card as HTMLElement).innerText ?? "",
        },
      ];
    }) as RawCard[];
  });
}

/**
 * La web del negocio, abriendo su ficha.
 *
 * Se navega en vez de pulsar la tarjeta porque volver atrás en el listado lo
 * vuelve a renderizar desde arriba: a partir de la décima ficha, la tarjeta que
 * había que pulsar ya no está en el DOM. Con la URL de la ficha da igual el
 * orden y da igual dónde estuviera el desplazamiento.
 */
async function readWebsite(
  page: import("playwright").Page,
  href: string,
): Promise<string | null> {
  const url = new URL(href, "https://www.google.com");
  url.searchParams.set("hl", "en");

  await page.goto(url.toString(), {
    waitUntil: "domcontentloaded",
    timeout: config.CRAWL_TIMEOUT_MS,
  });
  assertNotBlocked(page.url());

  const authority = page.locator('a[data-item-id="authority"]').first();
  await authority.waitFor({ state: "attached", timeout: 6_000 }).catch(() => {});

  if ((await authority.count()) === 0) return null;
  const value = await authority.getAttribute("href");
  return value && /^https?:/.test(value) ? value : null;
}

export interface SearchMapsArgs {
  query: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  /** Cuántas fichas abrir para sacar la web. Cada una es una navegación. */
  detailLimit: number;
}

export interface SearchMapsResult {
  cards: MapsCard[];
  /** Cuántos había dentro del radio antes de aplicar `detailLimit`. */
  found: number;
}

export async function searchMaps(args: SearchMapsArgs): Promise<SearchMapsResult> {
  return withPage(
    VIEWPORT.width,
    VIEWPORT.height,
    async (page) => {
      await page.goto(searchUrl(args.query, args.lat, args.lng, args.radiusMeters), {
        waitUntil: "domcontentloaded",
        timeout: config.CRAWL_TIMEOUT_MS,
      });

      await passConsent(page);
      assertNotBlocked(page.url());

      await page
        .locator('div[role="feed"]')
        .first()
        .waitFor({ state: "attached", timeout: 15_000 });

      await scrollFeed(page, args.detailLimit * 2);
      const raw = await readCards(page);

      /*
       * Los patrocinados fuera: son anuncios, no el resultado de la búsqueda, y
       * suelen ser cadenas grandes que nunca encajan en el ICP de un estudio.
       * Y fuera también lo que caiga fuera del radio de la zona: Maps ensancha
       * la búsqueda por su cuenta cuando encuentra poco cerca.
       */
      const center = { lat: args.lat, lng: args.lng };
      const seen = new Set<string>();
      const cards: MapsCard[] = [];

      for (const item of raw) {
        const card = toCard(item);
        if (!card || card.sponsored || seen.has(card.ftid)) continue;

        if (
          card.lat !== null &&
          card.lng !== null &&
          distanceMeters(center, { lat: card.lat, lng: card.lng }) > args.radiusMeters
        ) {
          continue;
        }

        seen.add(card.ftid);
        cards.push(card);
      }

      const found = cards.length;
      const wanted = cards.slice(0, args.detailLimit);
      for (const card of wanted) {
        const item = raw.find((r) => r.href.includes(card.ftid));
        if (!item) continue;
        try {
          card.website = await readWebsite(page, item.href);
        } catch (err) {
          if (err instanceof MapsBlocked) throw err;
          log.debug("no se pudo leer la ficha", { negocio: card.name, err: errorMessage(err) });
        }
      }

      return { cards: wanted, found };
    },
    { userAgent: config.MAPS_USER_AGENT, locale: "en-US" },
  );
}

// ─── Herramienta del agente ──────────────────────────────────────────────────

const inputSchema = {
  query: z
    .string()
    .describe(
      'Qué buscar, en inglés y como lo escribiría una persona en Google Maps: "custom kitchen cabinets", "architectural millwork". Los términos en inglés devuelven mucho más en el sur de Florida.',
    ),
  lat: z.number().describe("Latitud del centro de la búsqueda"),
  lng: z.number().describe("Longitud del centro de la búsqueda"),
  radiusMeters: z
    .number()
    .int()
    .min(500)
    .max(50_000)
    .describe("Radio en metros. Lo que caiga fuera se descarta."),
  detailLimit: z
    .number()
    .int()
    .min(1)
    .max(40)
    .optional()
    .describe(
      "Cuántas fichas abrir para sacar la web. Cada una es una navegación de varios segundos y es con diferencia lo más caro de esta herramienta, así que empieza barriendo con el valor por defecto (6) y súbelo solo para un término que ya hayas visto que rinde.",
    ),
};

type Input = {
  query: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  detailLimit?: number;
};

function line(card: MapsCard): string {
  const nota =
    card.rating !== null ? `${card.rating}★ (${card.reviewCount ?? 0})` : "sin valoraciones";
  return [
    card.name,
    card.category ?? "sector sin clasificar",
    card.address ?? "sin dirección",
    nota,
    card.website ?? "SIN WEB",
    card.phone ?? "sin teléfono",
    card.ftid,
  ].join(" | ");
}

export const searchMapsTool: AgentTool<Input> = {
  name: "search_maps",
  description:
    "Busca negocios en Google Maps dentro de un radio y devuelve, de cada uno: nombre, categoría, " +
    "dirección, valoración, número de reseñas, teléfono, web e identificador estable. " +
    "Es la herramienta de descubrimiento: úsala varias veces con términos distintos para cubrir un " +
    "sector, porque Maps devuelve cosas muy diferentes según cómo se pregunte. " +
    "Los resultados patrocinados y los que caen fuera del radio ya vienen descartados.",
  inputSchema,

  async run(input, ctx): Promise<ToolResult> {
    const detailLimit = input.detailLimit ?? 6;

    // Un solo hueco de rate limit para todo el barrido: dentro va una
    // navegación por ficha y no conviene encadenarlas sin freno.
    await ctx.rateLimit("www.google.com");

    let result: SearchMapsResult;
    try {
      result = await searchMaps({
        query: input.query,
        lat: input.lat,
        lng: input.lng,
        radiusMeters: input.radiusMeters,
        detailLimit,
      });
    } catch (err) {
      if (err instanceof MapsBlocked) {
        return { ok: false, errorCode: err.code, message: err.message };
      }
      return { ok: false, errorCode: "MAPS_FAILED", message: errorMessage(err) };
    }

    const { cards, found } = result;

    if (cards.length === 0) {
      return {
        ok: false,
        errorCode: "MAPS_EMPTY",
        message: `"${input.query}" no devolvió ningún negocio dentro del radio.`,
      };
    }

    const conWeb = cards.filter((c) => c.website).length;

    return {
      ok: true,
      summary: `${cards.length} negocios para "${input.query}" · ${conWeb} con web`,
      observations: [
        observe({
          tool: "search_maps",
          url: searchUrl(input.query, input.lat, input.lng, input.radiusMeters),
          quote: [
            `Búsqueda en Google Maps: "${input.query}" · radio ${input.radiusMeters} m`,
            `${found} negocios dentro del radio; se abrió la ficha de ${cards.length}, ${conWeb} con web`,
            found > cards.length
              ? `Quedan ${found - cards.length} sin abrir. Si este término rinde, repítelo con detailLimit más alto.`
              : "Se abrieron todos los que había.",
            "",
            "nombre | categoría | dirección | valoración | web | teléfono | id",
            ...cards.map(line),
          ].join("\n"),
          layer: "external_source",
          method: `Google Maps · navegador real · ${cards.length} fichas`,
          raw: { query: input.query, cards },
        }),
      ],
    };
  },
};
