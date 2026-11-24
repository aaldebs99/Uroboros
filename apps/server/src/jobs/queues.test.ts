import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testBus } from "../../test/bus.ts";
import { liveJobs } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { JobQueue } from "./queues.ts";
import { claim } from "./store.ts";

let t: TestDb;

beforeEach(async () => {
  t = await TestDb.create();
});

afterEach(async () => {
  await t.close();
});

describe("JobQueue", () => {
  it("refuses a second job with a live key and keeps the first one's data", async () => {
    const q = new JobQueue<{ n: number }>(t.db, "download");
    expect(await q.add("fetch", { n: 1 }, { key: "fetch|a" })).toBe(true);
    expect(await q.add("fetch", { n: 2 }, { key: "fetch|a" })).toBe(false);
    expect(await q.add("fetch", { n: 3 }, { key: "fetch|b" })).toBe(true);
    const jobs = await liveJobs(t.db, "download");
    expect(jobs.map((j) => [j.key, j.data])).toEqual([
      ["fetch|a", { n: 1 }],
      ["fetch|b", { n: 3 }],
    ]);
  });

  it("takes any number of jobs without a key, and a key again once its job is gone", async () => {
    const q = new JobQueue<{ n: number }>(t.db, "notify");
    expect(await q.add("notify", { n: 1 })).toBe(true);
    expect(await q.add("notify", { n: 1 })).toBe(true);
    const keyed = new JobQueue<{ n: number }>(t.db, "probe");
    await keyed.add("probe", { n: 1 }, { key: "probe|r" });
    await t.db.deleteFrom("jobs").where("key", "=", "probe|r").execute();
    expect(await keyed.add("probe", { n: 2 }, { key: "probe|r" })).toBe(true);
    expect(await liveJobs(t.db, "notify")).toHaveLength(2);
  });

  it("adds inside a transaction: invisible and silent until commit, gone after a rollback", async () => {
    const bus = testBus(t);
    try {
      await bus.ready;
      const q = new JobQueue<{ n: number }>(t.db, "probe");
      const woke: string[] = [];
      bus.on("uroboros_jobs", (queue) => woke.push(queue));
      await t.db.transaction().execute(async (trx) => {
        await q.add("probe", { n: 1 }, { key: "probe|1" }, trx);
        expect(await liveJobs(t.db, "probe")).toEqual([]);
        await new Promise((r) => setTimeout(r, 150));
        expect(woke).toEqual([]);
      });
      await vi.waitFor(() => {
        expect(woke).toEqual(["probe"]);
      });
      await expect(
        t.db.transaction().execute(async (trx) => {
          await q.add("probe", { n: 2 }, { key: "probe|2" }, trx);
          throw new Error("roll back");
        }),
      ).rejects.toThrow("roll back");
      expect((await liveJobs(t.db, "probe")).map((j) => j.key)).toEqual(["probe|1"]);
    } finally {
      await bus.close();
    }
  });

  it("removes a waiting or delayed job, never a running one", async () => {
    const q = new JobQueue<{ n: number }>(t.db, "download");
    await q.add("fetch", { n: 1 }, { key: "now" });
    await q.add("fetch", { n: 2 }, { key: "later", delayMs: 60_000 });
    expect(await q.removeQueued("later")).toBe(true);
    expect(await claim(t.db, "download", { limit: 1, leaseMs: 30_000, worker: "w" })).toHaveLength(
      1,
    );
    expect(await q.removeQueued("now")).toBe(false);
    expect(await q.removeQueued("missing")).toBe(false);
    expect((await q.get("now"))?.state).toBe("running");
    expect(await q.get("later")).toBeUndefined();
  });

  it("keeps a delayed job waiting until its time", async () => {
    const q = new JobQueue<{ n: number }>(t.db, "download");
    await q.add("fetch", { n: 1 }, { key: "later", delayMs: 400 });
    expect(await claim(t.db, "download", { limit: 1, leaseMs: 30_000, worker: "w" })).toEqual([]);
    await new Promise((r) => setTimeout(r, 450));
    expect(await claim(t.db, "download", { limit: 1, leaseMs: 30_000, worker: "w" })).toHaveLength(
      1,
    );
  });
  it("takes a long key (a fetch key of a long direct link)", async () => {
    const key = `fetch|generic|${"%E6%97%A5".repeat(400)}|p|r`;
    expect(await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key })).toBe(true);
    expect((await liveJobs(t.db, "download")).map((j) => j.key)).toEqual([key]);
  });
});
