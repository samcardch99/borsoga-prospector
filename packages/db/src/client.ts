/**
 * Cliente Postgres. Lo usan tanto la web (solo lectura de lo persistido) como
 * el worker. La web nunca habla con el modelo: lee de aquí.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Falta DATABASE_URL. Copia .env.example a .env.");
}

const client = postgres(connectionString, {
  max: Number(process.env.PG_POOL_MAX ?? 10),
  prepare: false,
});

export const db = drizzle(client, { schema });
export type Db = typeof db;
export { client as pgClient };
