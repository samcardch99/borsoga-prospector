"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export type Mode = "pc-light" | "pc-dark";
export type Accent = "p-bronce" | "p-tinta" | "p-pino";

const ACCENTS: Array<{ value: Accent; label: string }> = [
  { value: "p-tinta", label: "Tinta" },
  { value: "p-bronce", label: "Bronce" },
  { value: "p-pino", label: "Pino" },
];

/**
 * Conmutador de tema y acento. Escribe las clases directamente en <html>,
 * que es donde viven los tokens (ver theme.css).
 */
export function ThemeSwitcher() {
  const [mode, setMode] = useState<Mode>("pc-light");
  const [accent, setAccent] = useState<Accent>("p-tinta");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("pc-light", "pc-dark");
    root.classList.add(mode);
    root.classList.remove("p-bronce", "p-tinta", "p-pino");
    root.classList.add(accent);
  }, [mode, accent]);

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 rounded-md border border-line2 bg-field p-0.5">
        {ACCENTS.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => setAccent(a.value)}
            className={`h-7 rounded-sm px-2.5 text-sm transition-colors ${
              accent === a.value
                ? "bg-chip text-foreground"
                : "text-muted-foreground hover:bg-hover"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setMode(mode === "pc-light" ? "pc-dark" : "pc-light")}
        aria-label={mode === "pc-light" ? "Modo oscuro" : "Modo claro"}
        className="grid h-8 w-8 place-items-center rounded-md border border-line2 bg-field text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        {mode === "pc-light" ? <Moon size={14} /> : <Sun size={14} />}
      </button>
    </div>
  );
}
