import { readdirSync } from "node:fs";
import { pino } from "pino";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { apiConfig, fixtureMigrations, MIGRATIONS, recordingLogger } from "../../test/apiConfig.ts";
import { withAdmin } from "../../test/pgAdmin.ts";
import { createEmptyDatabase, TestDb } from "../../test/testDb.ts";
import { MIGRATE_KEY_NAME } from "../shared/lockKeys.ts";
import { type RunningApi, runUntilSignal, startApi } from "./main.ts";

const logger = pino({ level: "silent" });
const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function emptyDb(): Promise<string> {
  const db = await createEmptyDatabase(inject("postgresUrl"));
  cleanups.push(() => db.drop());
  return db.url;
}

async function migratedDb(): Promise<string> {
  const db = await TestDb.create();
  cleanups.push(() => db.close());
  return db.url;
}

function track(api: RunningApi): RunningApi {
  cleanups.push(() => api.close().catch(() => undefined));
  return api;
}

const get = (api: RunningApi, path: string) => fetch(`http://127.0.0.1:${String(api.port)}${path}`);

describe("api start-up", () => {
  it("is live but not ready until migrations ran, then ready", async () => {
    const url = await migratedDb();
    // Another runner holds the migration lock: this replica waits behind it.
    const holder = await withAdmin(url, async (c) => {
      await c.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATE_KEY_NAME]);
      const api = track(await startApi(apiConfig(url), logger));
      expect((await get(api, "/api/health")).status).toBe(200);
      const ready = await get(api, "/api/ready");
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: "starting", failing: [] });
      expect((await get(api, "/api/me/push")).status).toBe(503);
      await c.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATE_KEY_NAME]);
      return api;
    });
    await holder.attached;
    const ready = await get(holder, "/api/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ok", failing: [] });
  });

  it("applies the migrations once across two replicas starting together, and both get ready", async () => {
    const url = await emptyDb();
    const a = recordingLogger();
    const b = recordingLogger();
    const apis = await Promise.all([
      startApi(apiConfig(url), a.logger).then(track),
      startApi(apiConfig(url), b.logger).then(track),
    ]);
    await Promise.all(apis.map((api) => api.attached));
    for (const api of apis) expect((await get(api, "/api/ready")).status).toBe(200);
    const applied = [...a.lines, ...b.lines].flatMap((l) =>
      Array.isArray(l["applied"]) ? (l["applied"] as string[]) : [],
    );
    expect(applied.sort()).toEqual(readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")));
  });

  it("exits non-zero on a broken migration and never reports ready", async () => {
    const url = await emptyDb();
    const { logger: recording, lines } = recordingLogger();
    const api = track(
      await startApi(
        apiConfig(url, { migrationsDir: fixtureMigrations("migrations-bad-sql") }),
        recording,
      ),
    );
    await expect(api.attached).rejects.toThrow(/20261121143512_add_widget_color\.sql failed/);
    expect((await get(api, "/api/ready")).status).toBe(503);
    expect(await runUntilSignal(api, recording)).toBe(1);
    expect(lines.some((l) => l["msg"] === "startup failed; exiting")).toBe(true);
  });

  it("warns when the database is ahead of the build, and gets ready", async () => {
    const url = await migratedDb();
    const future = "20991231235959_from_a_newer_release.sql";
    await withAdmin(url, (c) =>
      c.query("INSERT INTO schema_migrations (name, sha256) VALUES ($1, 'x')", [future]),
    );
    const { logger: recording, lines } = recordingLogger();
    const api = track(await startApi(apiConfig(url), recording));
    await api.attached;
    expect((await get(api, "/api/ready")).status).toBe(200);
    const warning = lines.find((l) => l["level"] === 40 && Array.isArray(l["ahead"]));
    expect(warning?.["ahead"]).toEqual([future]);
  });
});

describe("api leadership", () => {
  it("has exactly one replica lead, and another take over once it stops", async () => {
    const url = await migratedDb();
    const opts = { leaderRetryMs: 100 };
    const apis = await Promise.all([
      startApi(apiConfig(url), logger, opts).then(track),
      startApi(apiConfig(url), logger, opts).then(track),
    ]);
    await Promise.all(apis.map((api) => api.attached));
    await vi.waitFor(() => {
      expect(apis.filter((api) => api.leader.leading)).toHaveLength(1);
    });
    const leader = apis.find((api) => api.leader.leading);
    const follower = apis.find((api) => !api.leader.leading);
    if (leader === undefined || follower === undefined) throw new Error("one of each expected");
    await leader.close();
    expect(leader.leader.leading).toBe(false);
    await vi.waitFor(
      () => {
        expect(follower.leader.leading).toBe(true);
      },
      { timeout: 5000 },
    );
  });
});
