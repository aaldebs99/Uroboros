import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { createDb } from "../src/db/kysely.ts";
import { runMigrations } from "../src/migrate/runner.ts";
import { composeImage } from "./composeImage.ts";
import { TEST_S3_KEY, TEST_S3_SECRET } from "./s3Credentials.ts";
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
 * Starts Postgres and RustFS once per run, unless UROBOROS_TEST_DATABASE_URL /
 * UROBOROS_TEST_S3_URL point at existing ones (CI services; RustFS must then use the credentials in
 * s3Credentials.ts). Testcontainers' Ryuk reaper
 * removes the containers even if this process crashes.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const stops: (() => Promise<unknown>)[] = [];

  let postgresUrl = process.env["UROBOROS_TEST_DATABASE_URL"];
  if (postgresUrl === undefined || postgresUrl === "") {
    const pg = await new PostgreSqlContainer(composeImage("postgres")).start();
    stops.push(() => pg.stop());
    postgresUrl = pg.getConnectionUri();
  }

  let s3Url = process.env["UROBOROS_TEST_S3_URL"];
  if (s3Url === undefined || s3Url === "") {
    const rustfs = await new GenericContainer(composeImage("rustfs"))
      .withEnvironment({ RUSTFS_ACCESS_KEY: TEST_S3_KEY, RUSTFS_SECRET_KEY: TEST_S3_SECRET })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/health", 9000).forStatusCode(200))
      .start();
    stops.push(() => rustfs.stop());
    s3Url = `http://${rustfs.getHost()}:${String(rustfs.getMappedPort(9000))}`;
  }

  try {
    await buildTemplate(postgresUrl);
  } catch (err) {
    await Promise.all(stops.map((stop) => stop()));
    throw err;
  }

  project.provide("postgresUrl", postgresUrl);
  project.provide("s3Url", s3Url);
  return async () => {
    await Promise.all(stops.map((stop) => stop()));
  };
}
