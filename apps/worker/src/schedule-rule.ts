/**
 * Cuándo toca escanear una zona. Solo la regla, sin base de datos.
 *
 * Está en su propio archivo porque la decisión es una función pura sobre
 * fechas y no tiene por qué arrastrar el cliente de Postgres para poder
 * razonarse ni probarse. Cuando vivía junto al planificador, un test de
 * `isDue` no arrancaba sin `DATABASE_URL` — que es una señal bastante clara de
 * que estaban mezcladas dos cosas.
 */

import { CronExpressionParser } from "cron-parser";

/**
 * Las expresiones cron se interpretan en hora de Florida, no en la del
 * servidor ni en UTC.
 *
 * Sin fijarlo, `0 3 * * 1` significaría cosas distintas según dónde corra el
 * worker, y el día que esto se despliegue en un servidor en UTC los escaneos
 * "de madrugada" pasarían a las once de la noche sin que nadie tocara nada.
 * El producto cubre Miami-Dade, Broward y Palm Beach: los tres están en la
 * misma zona, así que hay una respuesta correcta y conviene escribirla.
 */
export const SCHEDULE_TZ = "America/New_York";

/** Una expresión que no se puede parsear. Se avisa donde se llama. */
export function isValidSchedule(schedule: string): boolean {
  try {
    CronExpressionParser.parse(schedule, { tz: SCHEDULE_TZ });
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide si una zona toca ahora.
 *
 * Se calcula la siguiente ejecución **a partir del último escaneo**, no a
 * partir de ahora: si el worker ha estado apagado tres días, la zona semanal
 * tiene que dispararse al volver, no esperar a la semana siguiente.
 */
export function isDue(
  schedule: string,
  lastScanAt: Date | null,
  createdAt: Date,
  now: Date,
): boolean {
  const anchor = lastScanAt ?? createdAt;

  try {
    const interval = CronExpressionParser.parse(schedule, {
      currentDate: anchor,
      tz: SCHEDULE_TZ,
    });
    return interval.next().toDate() <= now;
  } catch {
    return false;
  }
}
