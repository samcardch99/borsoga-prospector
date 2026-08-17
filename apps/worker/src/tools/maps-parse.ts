/**
 * Lectura de una tarjeta de resultado de Google Maps.
 *
 * Va aparte del navegador a propósito. Lo que se rompe cuando Google cambia su
 * interfaz no es abrir la página ni desplazar la lista: es *interpretar* el
 * bloque de texto de la tarjeta. Teniéndolo aquí, en funciones puras que reciben
 * una cadena, se prueba sin levantar Chromium y se arregla mirando un caso
 * concreto en vez de una sesión entera.
 *
 * El texto se pide siempre en inglés (`hl=en`). No es cosmético: en español la
 * nota es "4,6" y en inglés "4.6", y el separador de la lista de campos cambia
 * también. Fijar el idioma convierte un parseo con dos dialectos en uno solo.
 */

/** Lo que se puede sacar de la tarjeta sin abrir la ficha del negocio. */
export interface MapsCard {
  /** Id estable de Google, `0x…:0x…`. Hace de `placeId`, que es columna única. */
  ftid: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  lat: number | null;
  lng: number | null;
  sponsored: boolean;
  /** Se rellena abriendo la ficha; la tarjeta del listado no la trae. */
  website: string | null;
}

/** Lo que el navegador devuelve por tarjeta, sin interpretar. */
export interface RawCard {
  name: string;
  href: string;
  text: string;
}

/**
 * Identificador y coordenadas, sacados del enlace de la tarjeta.
 *
 * Las coordenadas se prefieren de `!3d…!4d…`, que es la posición del negocio.
 * La forma `@lat,lng` que también trae el enlace es el centro del mapa en ese
 * momento, y usarla colocaría a todos los resultados de una búsqueda en el
 * mismo punto — justo el error que hace que un mapa de prospectos no sirva.
 */
export function parseHref(href: string): {
  ftid: string | null;
  lat: number | null;
  lng: number | null;
} {
  const ftid = href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1] ?? null;

  const exact = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (exact?.[1] && exact[2]) {
    return { ftid, lat: Number(exact[1]), lng: Number(exact[2]) };
  }

  const viewport = href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/);
  if (viewport?.[1] && viewport[2]) {
    return { ftid, lat: Number(viewport[1]), lng: Number(viewport[2]) };
  }

  return { ftid, lat: null, lng: null };
}

const RATING = /^(\d+[.,]\d+)\s*\(([\d.,]+)\)$/;

/** Diez dígitos con la puntuación habitual de EE. UU., con o sin prefijo. */
const PHONE = /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/**
 * Las líneas de horario también van separadas por `·`, igual que la de
 * categoría y dirección, así que hay que poder distinguirlas. Se reconocen por
 * cómo empiezan, que es lo único estable: el resto de la línea cambia con la
 * hora del día.
 */
const HOURS = /^(Open|Closed|Opens|Closes|Temporarily|Permanently|24 hours)\b/i;

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toCount(raw: string): number | null {
  const n = Number(raw.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Interpreta el bloque de texto de una tarjeta.
 *
 * La forma habitual es: nombre (repetido), nota y reseñas, una línea de
 * `categoría · dirección`, otra de horario y teléfono, y una cita de reseña.
 * Pero un negocio recién dado de alta no tiene nota, y entonces la línea de
 * categoría sube un puesto — por eso nada se localiza por índice fijo.
 *
 * Lo que no se pueda leer se devuelve como `null`. Un negocio sin dirección
 * legible sigue siendo un negocio; inventarle una dirección plausible sería
 * mucho peor que no tenerla, porque nadie volvería a comprobarla.
 */
export function parseCardText(text: string): {
  category: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  sponsored: boolean;
} {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const sponsored = lines.some((l) => /^(Sponsored|Patrocinado)$/i.test(l));

  let rating: number | null = null;
  let reviewCount: number | null = null;
  let ratingAt = -1;

  for (const [i, line] of lines.entries()) {
    const m = line.match(RATING);
    if (m?.[1] && m[2]) {
      rating = toNumber(m[1]);
      reviewCount = toCount(m[2]);
      ratingAt = i;
      break;
    }
  }

  /*
   * La línea de categoría y dirección es la primera con `·` que no sea de
   * horario. Si hay nota, se empieza a mirar justo después de ella; si no la
   * hay, desde el principio.
   */
  let category: string | null = null;
  let address: string | null = null;

  for (const line of lines.slice(ratingAt + 1)) {
    if (!line.includes("·") || HOURS.test(line)) continue;

    const parts = line
      .split("·")
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      category = parts[0] ?? null;
      address = parts[parts.length - 1] ?? null;
    } else if (parts.length === 1) {
      category = parts[0] ?? null;
    }
    break;
  }

  const phone = text.match(PHONE)?.[0]?.trim() ?? null;

  return { category, address, phone, rating, reviewCount, sponsored };
}

/** Junta enlace y texto en la ficha que consume el resto del worker. */
export function toCard(raw: RawCard): MapsCard | null {
  const { ftid, lat, lng } = parseHref(raw.href);
  if (!ftid) return null; // Sin id estable no se puede deduplicar ni guardar.

  const parsed = parseCardText(raw.text);

  return {
    ftid,
    name: raw.name.trim(),
    category: parsed.category,
    address: parsed.address,
    phone: parsed.phone,
    rating: parsed.rating,
    reviewCount: parsed.reviewCount,
    lat,
    lng,
    sponsored: parsed.sponsored,
    website: null,
  };
}
