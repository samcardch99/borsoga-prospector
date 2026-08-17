"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * El conmutador de la cabecera. Solo la luna: el selector de acento vive en la
 * página de tokens, no en la barra de trabajo.
 *
 * El tema no se guarda en estado de React sino que se *lee* de la clase de
 * `<html>`, que es donde viven los tokens. Eso lo convierte en un sistema
 * externo, y la forma correcta de leer un sistema externo en React es
 * `useSyncExternalStore`: se suscribe a los cambios de clase con un
 * MutationObserver en vez de copiar el valor en un `useState` dentro de un
 * efecto.
 *
 * La diferencia se nota: si otra parte de la aplicación cambia el tema —la
 * página de tokens, por ejemplo— este botón se entera. Con una copia en estado
 * local se quedaría mostrando la luna en modo oscuro.
 */

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains("pc-dark");
}

/** En el servidor no hay clase que leer: el layout arranca en `pc-light`. */
function getServerSnapshot(): boolean {
  return false;
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const root = document.documentElement;
    const next = !root.classList.contains("pc-dark");
    root.classList.toggle("pc-dark", next);
    root.classList.toggle("pc-light", !next);
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Modo claro" : "Modo oscuro"}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line2 bg-field text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      {dark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
