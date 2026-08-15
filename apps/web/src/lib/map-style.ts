/**
 * El estilo del mapa, generado desde los tokens de diseño.
 *
 * Esta es la razón de usar MapLibre y no Google. `theme.css` ya trae una paleta
 * de mapa completa —`--map-bg`, `--water`, `--island`, `--road1` a `--road4`,
 * `--block`— porque el handoff §9 trata el mapa como parte del diseño, no como
 * un widget de terceros. MapLibre consume un style JSON, así que esos tokens se
 * leen y se aplican directamente; con Google habría que recrear la paleta a
 * mano en la consola de Cloud, en un Map ID por tema y fuera del repositorio.
 *
 * La regla del handoff de que "en modo claro la rampa del mapa se invierte" no
 * se implementa aquí: ya está en los propios tokens (en claro `--block` es más
 * oscuro que `--island`; en oscuro, más claro que `--map-bg`). Al leerlos tal
 * cual, el mapa se invierte solo al cambiar de tema.
 */

import type { StyleSpecification } from "maplibre-gl";

/** Tiles vectoriales de OpenFreeMap: sin clave, sin registro, uso comercial. */
const TILES_URL = "https://tiles.openfreemap.org/planet";
const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** La única familia que sirve OpenFreeMap. Las etiquetas del mapa son suyas. */
const FONT = ["Noto Sans Regular"];

export interface MapPalette {
  bg: string;
  water: string;
  island: string;
  road1: string;
  road2: string;
  road3: string;
  block: string;
  label: string;
  labelHalo: string;
  /**
   * El acento, para el área de búsqueda. MapLibre pinta en WebGL y no entiende
   * `var(--accent)`: los colores que le llegan tienen que estar ya resueltos.
   */
  accent: string;
}

const FALLBACK: MapPalette = {
  bg: "#f1efea",
  water: "#dbe4e5",
  island: "#e8e5df",
  road1: "#e2ded6",
  road2: "#e9e5de",
  road3: "#d4cfc5",
  block: "#d6d1c8",
  label: "#6d737a",
  labelHalo: "#f1efea",
  accent: "#3a5a8c",
};

/**
 * Lee la paleta del `<html>` vivo. Hay que hacerlo en el navegador y no en el
 * servidor: los tokens son variables CSS y su valor depende de la clase de tema
 * que esté puesta en ese momento.
 */
export function readMapPalette(): MapPalette {
  if (typeof window === "undefined") return FALLBACK;

  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => {
    const value = cs.getPropertyValue(name).trim();
    return value || fallback;
  };

  return {
    bg: read("--map-bg", FALLBACK.bg),
    water: read("--water", FALLBACK.water),
    island: read("--island", FALLBACK.island),
    road1: read("--road1", FALLBACK.road1),
    road2: read("--road2", FALLBACK.road2),
    road3: read("--road3", FALLBACK.road3),
    block: read("--block", FALLBACK.block),
    label: read("--dim", FALLBACK.label),
    labelHalo: read("--map-bg", FALLBACK.labelHalo),
    accent: read("--accent", FALLBACK.accent),
  };
}

/**
 * Un basemap deliberadamente callado. Los marcadores llevan el score y son lo
 * que hay que leer; si el mapa compite con ellos, la pantalla no se puede usar.
 * Por eso no hay POI, ni iconos, ni relieve: solo agua, suelo, manzanas, tres
 * niveles de vía y los nombres de población.
 */
export function buildMapStyle(p: MapPalette): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      openmaptiles: { type: "vector", url: TILES_URL },
    },
    layers: [
      {
        id: "fondo",
        type: "background",
        paint: { "background-color": p.bg },
      },
      {
        id: "suelo",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        paint: { "fill-color": p.island, "fill-opacity": 0.7 },
      },
      {
        id: "parques",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        paint: { "fill-color": p.island, "fill-opacity": 0.9 },
      },
      {
        id: "agua",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "fill-color": p.water },
      },
      {
        id: "cauces",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        paint: { "line-color": p.water, "line-width": 1 },
      },
      {
        id: "manzanas",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-color": p.block,
          // Aparecen al acercarse, para que a poco zoom el mapa quede limpio.
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 0.85],
        },
      },
      {
        id: "vias-menores",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 12,
        filter: ["match", ["get", "class"], ["minor", "service", "track"], true, false],
        paint: {
          "line-color": p.road2,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 6],
        },
      },
      {
        id: "vias-secundarias",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary"], true, false],
        paint: {
          "line-color": p.road1,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 18, 10],
        },
      },
      {
        id: "vias-principales",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["match", ["get", "class"], ["motorway", "trunk"], true, false],
        paint: {
          "line-color": p.road3,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 18, 14],
        },
      },
      {
        id: "poblaciones",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["match", ["get", "class"], ["city", "town", "suburb"], true, false],
        layout: {
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 12],
          "text-letter-spacing": 0.04,
          "text-max-width": 8,
        },
        paint: {
          "text-color": p.label,
          "text-halo-color": p.labelHalo,
          "text-halo-width": 1.2,
        },
      },
    ],
  };
}
