import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Reuse one connection pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

const client = globalForDb.pg ?? postgres(process.env.DATABASE_URL!, { max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export { schema };
