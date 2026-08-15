/**
 * Elección del proveedor por variable de entorno. Nada más del worker sabe
 * cuál está en uso — que es justo el punto de tener la interfaz.
 */

import type { LLMProvider } from "@borsoga/shared";
import { config } from "../config";
import { anthropicApiProvider } from "./anthropic-api";
import { claudeCodeLocalProvider } from "./claude-code-local";

export function getProvider(): LLMProvider {
  return config.LLM_PROVIDER === "anthropic-api"
    ? anthropicApiProvider
    : claudeCodeLocalProvider;
}

export { RunRecorder } from "./recorder";
