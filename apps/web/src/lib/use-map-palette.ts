"use client";

import { useSyncExternalStore } from "react";
import { readMapPalette, type MapPalette } from "./map-style";

/**
 * La paleta del mapa, siguiendo el tema activo.
 *
 * El tema es una clase en `<html>`, o sea un sistema externo a React, así que
 * se lee con `useSyncExternalStore` y no copiándolo a estado dentro de un
 * efecto. Igual que el conmutador de la cabecera.
 *
 * El detalle que importa: `getSnapshot` tiene que devolver **la misma
 * referencia** mientras nada cambie. React compara con `Object.is`, y devolver
 * un objeto nuevo en cada llamada haría que se considerase siempre cambiado —
 * el mapa se reestilizaría en bucle. De ahí la caché por nombre de clase.
 */

const SERVER_SNAPSHOT: MapPalette = readMapPalette();

let cachedKey: string | null = null;
let cached: MapPalette = SERVER_SNAPSHOT;

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): MapPalette {
  const key = document.documentElement.className;
  if (key !== cachedKey) {
    cachedKey = key;
    cached = readMapPalette();
  }
  return cached;
}

function getServerSnapshot(): MapPalette {
  return SERVER_SNAPSHOT;
}

export function useMapPalette(): MapPalette {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
