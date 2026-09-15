import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle, NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";

// Local development only: point the Neon HTTP driver at a local proxy in front
// of a throwaway Postgres (see docs/auth.md). Ignored in production builds.
if (process.env.NEON_LOCAL_HTTP_ENDPOINT && process.env.NODE_ENV !== "production") {
  neonConfig.fetchEndpoint = process.env.NEON_LOCAL_HTTP_ENDPOINT;
}

let _db: NeonHttpDatabase<typeof schema> | null = null;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const sql = neon(url);
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
