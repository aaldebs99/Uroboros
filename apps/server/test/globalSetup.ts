import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { createDb } from "../src/db/kysely.ts";
import { runMigrations } from "../src/migrate/runner.ts";
import { TEMPLATE_DB, withDatabase } from "./dbUrl.ts";
import { withAdmin } from "./pgAdmin.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../migrations", import.meta.url));

/**
 * (Re)creates `uroboros_template` from the real migrations and freezes it as a template that
 * nobody may connect to. Every test clones it. Same approach as the Rust template's test-support.
 */
async function buildTemplate(adminUrl: string): Promise<void> {
  await withAdmin(adminUrl, async (admin) => {
    // A template cannot be dropped until the flag is cleared.
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEMPLATE_DB]);
    if (exists.rowCount) {
      await admin.query(
        `ALTER DATABASE ${TEMPLATE_DB} WITH IS_TEMPLATE false ALLOW_CONNECTIONS true`,
      );
      await admin.query(`DROP DATABASE ${TEMPLATE_DB} WITH (FORCE)`);
    }
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);

    const db = createDb(withDatabase(adminUrl, TEMPLATE_DB));
    try {
      await runMigrations(db, MIGRATIONS);
    } finally {
      await db.destroy();
    }
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [
      TEMPLATE_DB,
    ]);
    await admin.query(
      `ALTER DATABASE ${TEMPLATE_DB} WITH ALLOW_CONNECTIONS false IS_TEMPLATE true`,
    );
  });
}

/**
 * Starts Postgres and Valkey once per run, unless UROBOROS_TEST_DATABASE_URL /
 * UROBOROS_TEST_VALKEY_URL point at existing ones (CI services). Testcontainers' Ryuk reaper
 * removes the containers even if this process crashes.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const stops: (() => Promise<unknown>)[] = [];

  let postgresUrl = process.env["UROBOROS_TEST_DATABASE_URL"];
  if (postgresUrl === undefined || postgresUrl === "") {
    const pg = await new PostgreSqlContainer("postgres:18-alpine").start();
    stops.push(() => pg.stop());
    postgresUrl = pg.getConnectionUri();
  }

  let valkeyUrl = process.env["UROBOROS_TEST_VALKEY_URL"];
  if (valkeyUrl === undefined || valkeyUrl === "") {
    const valkey = await new GenericContainer("valkey/valkey:8-alpine")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    stops.push(() => valkey.stop());
    valkeyUrl = `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`;
  }

  try {
    await buildTemplate(postgresUrl);
  } catch (err) {
    await Promise.all(stops.map((stop) => stop()));
    throw err;
  }

  project.provide("postgresUrl", postgresUrl);
  project.provide("valkeyUrl", valkeyUrl);
  return async () => {
    await Promise.all(stops.map((stop) => stop()));
  };
}
