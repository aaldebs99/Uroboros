import type { Kysely } from "kysely";
import { inject } from "vitest";
import { createDb } from "../src/db/kysely.ts";
import type { Database } from "../src/db/schema.ts";
import { TEMPLATE_DB, uniqueTestName, withDatabase } from "./dbUrl.ts";
import { withAdmin } from "./pgAdmin.ts";

/** Postgres error 55006: the template has a session, e.g. a concurrent clone. Retry briefly. */
const OBJECT_IN_USE = "55006";

async function createDatabase(adminUrl: string, name: string, template?: string): Promise<void> {
  const sql = `CREATE DATABASE ${name}${template === undefined ? "" : ` TEMPLATE ${template}`}`;
  await withAdmin(adminUrl, async (admin) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.query(sql);
        return;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== OBJECT_IN_USE || attempt >= 50) throw err;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });
}

async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  await withAdmin(adminUrl, (admin) => admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
}

/** A database with no template, so it starts completely empty (for the migration runner tests). */
export async function createEmptyDatabase(
  adminUrl: string,
): Promise<{ url: string; drop(): Promise<void> }> {
  const name = uniqueTestName();
  await createDatabase(adminUrl, name);
  return { url: withDatabase(adminUrl, name), drop: () => dropDatabase(adminUrl, name) };
}

export interface TestDb {
  db: Kysely<Database>;
  url: string;
  close(): Promise<void>;
}

export const TestDb = {
  /** Clones the migrated `uroboros_template` into a fresh database. Call `close()` when done. */
  async create(): Promise<TestDb> {
    const adminUrl = inject("postgresUrl");
    const name = uniqueTestName();
    await createDatabase(adminUrl, name, TEMPLATE_DB);
    const url = withDatabase(adminUrl, name);
    const db = createDb(url);
    return {
      db,
      url,
      async close() {
        await db.destroy();
        await dropDatabase(adminUrl, name);
      },
    };
  },
};
