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

import type {
  FilterSpecification,
  Map as MapLibreMapInstance,
  StyleSpecification,
} from "maplibre-gl";

/** Tiles vectoriales de OpenFreeMap: sin clave, sin registro, uso comercial. */
const TILES_URL = "https://tiles.openfreemap.org/planet";
const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** La única familia que sirve OpenFreeMap. Las etiquetas del mapa son suyas. */
const FONT = ["Noto Sans Regular"];

/**
 * Qué sitios merecen etiqueta.
 *
 * Dos cortes, y los dos salieron de mirar la pantalla. `rank` es el orden de
 * importancia que trae el propio tileset, así que cortar por 12 deja los
 * sitios que sirven de referencia y descarta la cola larga.
 *
 * El segundo corte es el que de verdad limpia el mapa: fuera el transporte y
 * el aparcamiento. Cada boca de metro y cada parada de autobús es un POI
 * distinto con el mismo nombre, así que sin este filtro "Brickell Station"
 * aparecía cuatro veces sobre la misma manzana y el marcador del prospecto se
 * perdía entre ellas. Para prospección comercial no aportan nada.
 */
const POI_FILTER: FilterSpecification = [
  "all",
  ["<=", ["get", "rank"], 12],
  [
    "!",
    [
      "match",
      ["get", "class"],
      ["bus", "railway", "ferry_terminal", "parking", "bicycle", "car"],
      true,
      false,
    ],
  ],
] as const;

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
  /** Etiquetas secundarias: calles y sitios. Un escalón por debajo de `label`. */
  labelSoft: string;
  /** El punto de los sitios. Decorativo, no lleva texto. */
  poiDot: string;
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
  label: "#41454a",
  labelHalo: "#f6f4f0",
  labelSoft: "#63686f",
  poiDot: "#6d737a",
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
    /*
     * Las etiquetas NO usan `--dim` / `--dim2`. El propio README documenta que
     * esos dos tokens no llegan a 4,5:1 contra los fondos claros, y sobre el
     * mapa el problema es peor: compiten con calles y manzanas, no con un panel
     * liso. Se suben un escalón, a `--text2` y `--muted`, que sí cumplen.
     */
    label: read("--text2", FALLBACK.label),
    labelHalo: read("--map-bg", FALLBACK.labelHalo),
    labelSoft: read("--muted", FALLBACK.labelSoft),
    poiDot: read("--dim", FALLBACK.poiDot),
    accent: read("--accent", FALLBACK.accent),
  };
}

/**
 * Un basemap callado, pero no mudo.
 *
 * La primera versión no llevaba ninguna referencia —ni calles con nombre, ni
 * sitios— con la idea de que nada compitiera con los marcadores de score. Visto
 * en pantalla era un error: sin referencias no se sabe qué barrio se está
 * mirando, y la pregunta que hace uno frente a esta pantalla es precisamente
 * "¿dónde está este negocio?".
 *
 * El equilibrio es jerarquía, no ausencia. Los marcadores van en color de marca
 * y a 29–38 px; las referencias van en gris (`--dim2`), pequeñas, y solo
 * aparecen al acercarse. Los sitios además se filtran por `rank`, que es el
 * orden de importancia que trae el propio tileset.
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
          /*
           * Aparecen al acercarse, para que a poco zoom el mapa quede limpio.
           * El tope es 0,55 y no 1: `--block` es ahora bastante más oscuro que
           * el suelo —eso es lo que da el contraste— y a plena opacidad el
           * centro de una ciudad se convierte en una mancha sólida que se come
           * las calles.
           */
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 0.55],
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
      {
        id: "agua-nombres",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "water_name",
        minzoom: 9,
        layout: {
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": 11,
          "text-max-width": 8,
        },
        paint: {
          "text-color": p.labelSoft,
          "text-halo-color": p.labelHalo,
          "text-halo-width": 1.2,
        },
      },
      {
        id: "calles",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        minzoom: 14,
        layout: {
          "text-field": ["get", "name"],
          "text-font": FONT,
          // Sobre la propia línea de la calle, como cualquier mapa de calle.
          "symbol-placement": "line",
          "text-size": 10,
          "text-letter-spacing": 0.02,
          "text-padding": 2,
        },
        paint: {
          "text-color": p.labelSoft,
          "text-halo-color": p.labelHalo,
          "text-halo-width": 1.4,
        },
      },
      {
        id: "sitios-punto",
        type: "circle",
        source: "openmaptiles",
        "source-layer": "poi",
        minzoom: 15,
        filter: POI_FILTER,
        paint: {
          "circle-radius": 2,
          "circle-color": p.poiDot,
        },
      },
      {
        id: "sitios",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "poi",
        minzoom: 15,
        filter: POI_FILTER,
        layout: {
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": 10,
          "text-anchor": "top",
          "text-offset": [0, 0.6],
          "text-max-width": 9,
          // Que se caiga la etiqueta antes que taparse con otra.
          "text-optional": true,
        },
        paint: {
          "text-color": p.labelSoft,
          "text-halo-color": p.labelHalo,
          "text-halo-width": 1.4,
        },
      },
    ],
  };
}

/** Qué token pinta cada capa. Es la tabla que usan el estilo y el repintado. */
const PAINT_BINDINGS: ReadonlyArray<
  readonly [layer: string, property: string, token: keyof MapPalette]
> = [
  ["fondo", "background-color", "bg"],
  ["suelo", "fill-color", "island"],
  ["parques", "fill-color", "island"],
  ["agua", "fill-color", "water"],
  ["cauces", "line-color", "water"],
  ["manzanas", "fill-color", "block"],
  ["vias-menores", "line-color", "road2"],
  ["vias-secundarias", "line-color", "road1"],
  ["vias-principales", "line-color", "road3"],
  ["poblaciones", "text-color", "label"],
  ["poblaciones", "text-halo-color", "labelHalo"],
  ["agua-nombres", "text-color", "labelSoft"],
  ["agua-nombres", "text-halo-color", "labelHalo"],
  ["calles", "text-color", "labelSoft"],
  ["calles", "text-halo-color", "labelHalo"],
  ["sitios", "text-color", "labelSoft"],
  ["sitios", "text-halo-color", "labelHalo"],
  ["sitios-punto", "circle-color", "poiDot"],
];

/**
 * Repinta el mapa con otra paleta **sin** reemplazar el estilo.
 *
 * La alternativa obvia —pasarle a MapLibre un style JSON nuevo cada vez que
 * cambia el tema— funciona, pero `setStyle` desmonta las fuentes y las vuelve a
 * montar: durante ese hueco el mapa se queda sin tiles y pinta un fotograma
 * equivocado antes de recolocarse. Se ve como un salto feo justo al pulsar la
 * luna.
 *
 * Cambiar solo las propiedades de pintado no toca las fuentes ni los tiles ya
 * descargados, así que el cambio de tema es instantáneo y sin parpadeo.
 */
export function applyMapPalette(map: MapLibreMapInstance, p: MapPalette): void {
  if (!map.isStyleLoaded()) return;

  for (const [layer, property, token] of PAINT_BINDINGS) {
    if (!map.getLayer(layer)) continue;
    map.setPaintProperty(layer, property, p[token]);
  }
}
