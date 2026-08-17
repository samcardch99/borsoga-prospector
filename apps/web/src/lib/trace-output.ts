/**
 * Lectura del `output` de un paso de traza.
 *
 * `trace_steps.output` es una columna `jsonb` sin forma fija: cada tipo de paso
 * escribe lo suyo (una llamada a herramienta guarda observaciones, un fallo
 * guarda un código de error, un run del agente guarda su resumen) y además hay
 * filas escritas antes de que existiera cualquiera de esos campos.
 *
 * Por eso esto comprueba la forma en vez de afirmarla. Una aserción de tipo
 * sobre un `jsonb` no valida nada: compila igual y revienta en producción. Aquí
 * ya pasó — dar por hecho que `observations` era un array tiró la página entera
 * con un `find is not a function` en cuanto se topó con una fila antigua.
 */

/**
 * La clave de almacenamiento de la captura más reciente que produjo el paso, o
 * `null` si ese paso no hizo ninguna.
 */
export function screenshotKeyOf(output: unknown): string | null {
  if (typeof output !== "object" || output === null) return null;

  const observations = (output as { observations?: unknown }).observations;
  if (!Array.isArray(observations)) return null;

  for (const observation of observations) {
    if (typeof observation !== "object" || observation === null) continue;
    const key = (observation as { screenshot?: unknown }).screenshot;
    if (typeof key === "string" && key.length > 0) return key;
  }

  return null;
}
