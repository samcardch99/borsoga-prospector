/**
 * Log de línea por evento. El registro que importa de verdad son los
 * `trace_steps` en Postgres — esto es solo para ver qué hace el proceso
 * mientras corre en una terminal.
 */

import { config } from "./config";

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof ORDER;

const threshold = ORDER[config.LOG_LEVEL];

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), msg];
  if (fields && Object.keys(fields).length > 0) {
    parts.push(
      Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" "),
    );
  }
  const line = parts.join(" ");
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

/** Mensaje de un error desconocido, sin perder el caso de que no sea Error. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}
