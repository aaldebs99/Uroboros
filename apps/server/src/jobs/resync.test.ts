import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cutListeners, testBus } from "../../test/bus.ts";
import { eventually } from "../../test/eventually.ts";
import { TestDb } from "../../test/testDb.ts";
import type { PgBus } from "../db/notifications.ts";
import { JobQueue } from "./queues.ts";
import { type JobWorker, startJobWorker } from "./worker.ts";

let t: TestDb;
let bus: PgBus;
let worker: JobWorker | undefined;

beforeEach(async () => {
  t = await TestDb.create();
  // A second away after a cut: long enough for a job added meanwhile to lose its NOTIFY.
  bus = testBus(t, { firstBackoffMs: 1000, maxBackoffMs: 1000 });
  await bus.ready;
});
afterEach(async () => {
  await worker?.drain();
  worker = undefined;
  await bus.close();
  await t.close();
});

describe("a job worker whose listener was cut", () => {
  it("runs a job added while it was away once the listener is back, not at its poll", async () => {
    const seen: number[] = [];
    worker = startJobWorker({
      db: t.db,
      bus,
      logger: pino({ level: "silent" }),
      consumers: [
        {
          queue: "probe",
          concurrency: 1,
          process: (job) => {
            seen.push((job.data as { n: number }).n);
            return Promise.resolve();
          },
        },
      ],
      // The poll is a minute away: only the reconnect's resync can find the job in time.
      pollMs: 60_000,
    });
    expect(await cutListeners(t.db)).toBe(1);
    await new JobQueue(t.db, "probe").add("probe", { n: 1 });
    await eventually(() => {
      expect(seen).toEqual([1]);
    });
  });
});
