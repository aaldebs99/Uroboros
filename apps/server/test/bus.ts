import { sql } from "kysely";
import type { Kysely } from "kysely";
import { pino } from "pino";
import { inject } from "vitest";
import type { Database } from "../src/db/schema.ts";
import { createPgBus, LISTEN_APPLICATION_NAME } from "../src/db/notifications.ts";
import type { Channel, PgBus, PgBusOptions } from "../src/db/notifications.ts";
import { withDatabase } from "./dbUrl.ts";
import type { TestDb } from "./testDb.ts";

/** A started bus on the test database, quick to reconnect. Close it at the end. */
export function testBus(t: Pick<TestDb, "url">, opts: PgBusOptions = {}): PgBus {
  const bus = createPgBus(t.url, {
    logger: pino({ level: "silent" }),
    firstBackoffMs: 50,
    maxBackoffMs: 200,
    ...opts,
  });
  bus.start();
  return bus;
}

/** A started bus on the database `db` is connected to (for helpers handed only the db). */
export async function busFor(db: Kysely<Database>, opts: PgBusOptions = {}): Promise<PgBus> {
  const r = await sql<{ name: string }>`SELECT current_database() AS name`.execute(db);
  const name = r.rows[0]?.name ?? "";
  return testBus({ url: withDatabase(inject("postgresUrl"), name) }, opts);
}

/** Ends every listener connection in this test's database, as a server restart would. */
export async function cutListeners(db: Kysely<Database>): Promise<number> {
  const r = await sql<{ cut: number }>`
    SELECT count(pg_terminate_backend(pid))::int AS cut FROM pg_stat_activity
    WHERE application_name = ${LISTEN_APPLICATION_NAME} AND datname = current_database()
      AND pid <> pg_backend_pid()`.execute(db);
  return r.rows[0]?.cut ?? 0;
}

/**
 * The next payload on `channel`, or a rejection after `ms`. Listening starts at the call, so take
 * it before the action and await it after. A test that fails in between never awaits it, so its
 * timeout is marked handled here rather than reported later as an unhandled rejection, which vitest
 * may pin on another test. Awaiting it still throws.
 */
export function nextMessage(bus: PgBus, channel: Channel, ms = 5000): Promise<string> {
  const next = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no message on ${channel} within ${String(ms)} ms`));
    }, ms);
    const off = bus.on(channel, (payload) => {
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });
  next.catch(() => undefined);
  return next;
}
