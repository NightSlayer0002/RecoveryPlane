import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { schema } from "./schema.js";
export interface Sql {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  mode: "local" | "postgres";
}
export async function openDatabase(url: string): Promise<Database> {
  let db: Database;
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    db = {
      mode: "postgres",
      query: (sql, params) => pool.query(sql, params),
      close: () => pool.end(),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else {
    if (url !== ":memory:")
      await mkdir(dirname(resolve(url)), { recursive: true });
    const local = new PGlite(url === ":memory:" ? undefined : resolve(url));
    db = {
      mode: "local",
      query: (sql, params) => local.query(sql, params),
      transaction: (fn) => local.transaction((tx) => fn(tx)),
      close: () => local.close(),
    };
  }
  await db.transaction(async (tx) => {
    for (const statement of schema) await tx.query(statement);
  });
  return db;
}
