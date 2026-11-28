import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventually } from "../../test/eventually.ts";
import { TestDb } from "../../test/testDb.ts";
import { LeaderStatus } from "../shared/leader.ts";
import { createFilesystemStore } from "../storage/filesystem.ts";
import { beat, newReplica, type HeartbeatDeps, startHeartbeat } from "./heartbeat.ts";

/** Each replica checks in for Admin › Health (docs/health.md). */

let t: TestDb;

beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

const silent = pino({ level: "silent" });

const depsWith = (
  stat: () => Promise<{ size: number } | null>,
  leader = new LeaderStatus(),
): HeartbeatDeps => ({
  db: t.db,
  store: { stat, localPath: () => null },
  leader,
  version: "9.8.7",
  logger: silent,
  checkMs: 200,
});

const rowOf = (id: string) =>
  t.db.selectFrom("replicas").selectAll().where("id", "=", id).executeTakeFirst();

describe("a replica's check-in", () => {
  it("checks in at once with its host, pid, version, start and whether it leads", async () => {
    const self = newReplica();
    const stop = new AbortController();
    const running = startHeartbeat(
      depsWith(() => Promise.resolve(null)),
      self,
      stop.signal,
    );
    await eventually(async () => {
      expect(await rowOf(self.id)).toMatchObject({
        host: self.host,
        pid: process.pid,
        version: "9.8.7",
        started_at: self.startedAt,
        leader: false,
        failing: [],
      });
    });
    stop.abort();
    await running;
    // A clean stop takes its row with it.
    expect(await rowOf(self.id)).toBeUndefined();
  });

  it("leaves no row behind when a slow check-in was still underway as it stopped", async () => {
    const self = newReplica();
    const leader = new LeaderStatus();
    // The first check-in's storage check hangs (up to its 200 ms); the ones after answer at once.
    let calls = 0;
    const stat = () => (++calls === 1 ? new Promise<null>(() => undefined) : Promise.resolve(null));
    const stop = new AbortController();
    const running = startHeartbeat(depsWith(stat, leader), self, stop.signal);
    // Leading starts a second check-in, which finishes while the first still waits.
    leader.setLeader(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop.abort();
    await running;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await rowOf(self.id)).toBeUndefined();
  });

  it("moves its last-seen time and its leader flag with every beat", async () => {
    const self = newReplica();
    const leader = new LeaderStatus();
    const deps = depsWith(() => Promise.resolve(null), leader);
    await beat(deps, self);
    await t.db
      .updateTable("replicas")
      .set({ seen_at: sql<Date>`now() - interval '1 minute'` })
      .where("id", "=", self.id)
      .execute();
    leader.setLeader(true);
    await beat(deps, self);
    const row = await rowOf(self.id);
    expect(row?.leader).toBe(true);
    expect(Date.now() - (row?.seen_at.getTime() ?? 0)).toBeLessThan(10_000);
  });

  it("says its storage fails when the store errs or doesn't answer in time", async () => {
    for (const stat of [
      () => Promise.reject(new Error("connect ECONNREFUSED")),
      () => new Promise<null>(() => undefined),
    ]) {
      const self = newReplica();
      await beat(depsWith(stat), self);
      expect((await rowOf(self.id))?.failing).toEqual(["storage"]);
    }
  });

  it("says its storage fails when a filesystem store's folder is gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "uroboros-health-"));
    for (const [dir, failing] of [
      [root, []],
      [join(root, "unmounted"), ["storage"]],
    ] as const) {
      const self = newReplica();
      await beat(
        { ...depsWith(() => Promise.resolve(null)), store: createFilesystemStore(dir) },
        self,
      );
      expect((await rowOf(self.id))?.failing).toEqual(failing);
    }
    await rm(root, { recursive: true });
  });

  it("forgets replicas unseen for an hour", async () => {
    const gone = newReplica();
    const quiet = newReplica();
    for (const [r, ago] of [
      [gone, "2 hours"],
      [quiet, "10 minutes"],
    ] as const) {
      await t.db
        .insertInto("replicas")
        .values({
          id: r.id,
          host: r.host,
          pid: r.pid,
          version: "0.0.1",
          started_at: r.startedAt,
          seen_at: sql<Date>`now() - ${ago}::interval`,
        })
        .execute();
    }
    await beat(
      depsWith(() => Promise.resolve(null)),
      newReplica(),
    );
    expect(await rowOf(gone.id)).toBeUndefined();
    expect(await rowOf(quiet.id)).toBeDefined();
  });
});
