import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveJobs } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { JobQueue } from "./queues.ts";
import type { QueueName } from "./queues.ts";
import { recoverStalled } from "./stalls.ts";
import { claim } from "./store.ts";

let t: TestDb;
const logger = pino({ level: "silent" });

beforeEach(async () => {
  t = await TestDb.create();
});

afterEach(async () => {
  await t.close();
});

/** Claims the queue's one job with a lease that has already lapsed. */
async function stall(queue: QueueName): Promise<void> {
  const [job] = await claim(t.db, queue, { limit: 1, leaseMs: 1, worker: "gone" });
  expect(job).toBeDefined();
  await new Promise((r) => setTimeout(r, 20));
}

describe("stall recovery", () => {
  it("puts back a job whose lease lapsed, giving its attempt back", async () => {
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "k", attempts: 3 });
    await stall("download");
    expect(await recoverStalled(t.db, logger)).toEqual({ requeued: 1, dropped: 0 });
    expect(await liveJobs(t.db, "download")).toMatchObject([
      { state: "queued", attempts: 0, stalls: 1 },
    ]);
  });

  it("leaves a job whose lease is current alone", async () => {
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "k" });
    await claim(t.db, "download", { limit: 1, leaseMs: 60_000, worker: "alive" });
    expect(await recoverStalled(t.db, logger)).toEqual({ requeued: 0, dropped: 0 });
  });

  it("drops a download on its third stall and a notify on its second", async () => {
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "d" });
    await new JobQueue(t.db, "notify").add("notify", { n: 1 });
    for (let round = 0; round < 2; round++) {
      await stall("download");
      await stall("notify");
      await recoverStalled(t.db, logger);
    }
    expect(await liveJobs(t.db, "notify")).toEqual([]);
    expect(await liveJobs(t.db, "download")).toMatchObject([{ stalls: 2 }]);
    await stall("download");
    expect(await recoverStalled(t.db, logger)).toEqual({ requeued: 0, dropped: 1 });
    expect(await liveJobs(t.db, "download")).toEqual([]);
  });
});
