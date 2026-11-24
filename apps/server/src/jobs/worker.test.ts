import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testBus } from "../../test/bus.ts";
import { liveJobs } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import type { PgBus } from "../db/notifications.ts";
import { RequeueError, UnrecoverableError } from "./errors.ts";
import { JobQueue } from "./queues.ts";
import type { Job, QueueName } from "./queues.ts";
import { recoverStalled } from "./stalls.ts";
import { startJobWorker } from "./worker.ts";
import type { Consumer, JobWorker, JobWorkerOptions } from "./worker.ts";

let t: TestDb;
let bus: PgBus;
const workers: JobWorker[] = [];
const logger = pino({ level: "silent" });

beforeEach(async () => {
  t = await TestDb.create();
  bus = testBus(t);
  await bus.ready;
});

afterEach(async () => {
  await Promise.all(workers.splice(0).map((w) => w.drain()));
  await bus.close();
  await t.close();
});

function worker(consumers: Consumer[], opts: Partial<JobWorkerOptions> = {}): JobWorker {
  const w = startJobWorker({ db: t.db, bus, logger, consumers, pollMs: 60_000, ...opts });
  workers.push(w);
  return w;
}

function consumer(
  queue: QueueName,
  process: (job: Job<{ n: number }>) => Promise<void>,
  concurrency = 1,
): Consumer {
  return { queue, concurrency, process: process as Consumer["process"] };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** A processor that only records, synchronously. */
const noting =
  (note: (job: Job<{ n: number }>) => void) =>
  (job: Job<{ n: number }>): Promise<void> => {
    note(job);
    return Promise.resolve();
  };

describe("the job worker", () => {
  it("starts a job as soon as it is added", async () => {
    const seen: number[] = [];
    worker([
      consumer(
        "probe",
        noting((job) => seen.push(job.data.n)),
      ),
    ]);
    await wait(100);
    const started = Date.now();
    await new JobQueue(t.db, "probe").add("probe", { n: 1 });
    await vi.waitFor(() => {
      expect(seen).toEqual([1]);
    });
    expect(Date.now() - started).toBeLessThan(2000);
    await vi.waitFor(async () => {
      expect(await liveJobs(t.db, "probe")).toEqual([]);
    });
  });

  it("still finds work on its poll when nobody tells it", async () => {
    const quiet = testBus({ url: "postgres://nobody:nothing@127.0.0.1:1/none" });
    const seen: number[] = [];
    try {
      worker(
        [
          consumer(
            "notify",
            noting((job) => seen.push(job.data.n)),
          ),
        ],
        {
          bus: quiet,
          pollMs: 200,
        },
      );
      await new JobQueue(t.db, "notify").add("notify", { n: 7 });
      await vi.waitFor(() => {
        expect(seen).toEqual([7]);
      });
    } finally {
      await quiet.close();
    }
  });

  it("runs a delayed job no earlier than its delay", async () => {
    let ranAt = 0;
    worker([
      consumer(
        "probe",
        noting(() => (ranAt = Date.now())),
      ),
    ]);
    const added = Date.now();
    await new JobQueue(t.db, "probe").add("probe", { n: 1 }, { delayMs: 500 });
    await vi.waitFor(() => {
      expect(ranAt).toBeGreaterThan(0);
    });
    expect(ranAt - added).toBeGreaterThanOrEqual(450);
  });

  it("retries a failing job with backoff, telling it how many runs failed, then drops it", async () => {
    const runs: { made: number; at: number }[] = [];
    worker([
      consumer("download", (job) => {
        runs.push({ made: job.attemptsMade, at: Date.now() });
        return Promise.reject(new Error("network"));
      }),
    ]);
    await new JobQueue(t.db, "download").add(
      "fetch",
      { n: 1 },
      { key: "k", attempts: 3, backoff: { type: "exponential", delayMs: 150 } },
    );
    await vi.waitFor(() => {
      expect(runs).toHaveLength(3);
    });
    expect(runs.map((r) => r.made)).toEqual([0, 1, 2]);
    expect((runs[1]?.at ?? 0) - (runs[0]?.at ?? 0)).toBeGreaterThanOrEqual(130);
    expect((runs[2]?.at ?? 0) - (runs[1]?.at ?? 0)).toBeGreaterThanOrEqual(280);
    await vi.waitFor(async () => {
      expect(await liveJobs(t.db, "download")).toEqual([]);
    });
  });

  it("drops a job at once on an UnrecoverableError", async () => {
    let runs = 0;
    worker([
      consumer("download", () => {
        runs++;
        return Promise.reject(new UnrecoverableError("refused"));
      }),
    ]);
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "k", attempts: 3 });
    await vi.waitFor(async () => {
      expect(runs).toBe(1);
      expect(await liveJobs(t.db, "download")).toEqual([]);
    });
    await wait(200);
    expect(runs).toBe(1);
  });

  it("puts a job back without spending an attempt on a RequeueError", async () => {
    const made: number[] = [];
    worker([
      consumer("playback", (job) => {
        made.push(job.attemptsMade);
        return made.length === 1 ? Promise.reject(new RequeueError(0)) : Promise.resolve();
      }),
    ]);
    await new JobQueue(t.db, "playback").add("playback", { n: 1 }, { key: "p" });
    await vi.waitFor(async () => {
      expect(made).toEqual([0, 0]);
      expect(await liveJobs(t.db, "playback")).toEqual([]);
    });
  });

  it("runs at most its concurrency at once", async () => {
    let now = 0;
    let most = 0;
    worker([
      consumer(
        "download",
        async () => {
          now++;
          most = Math.max(most, now);
          await wait(100);
          now--;
        },
        2,
      ),
    ]);
    const q = new JobQueue(t.db, "download");
    for (let n = 0; n < 6; n++) await q.add("fetch", { n }, { key: `k${String(n)}` });
    await vi.waitFor(async () => {
      expect(await liveJobs(t.db, "download")).toEqual([]);
    });
    expect(most).toBe(2);
  });

  it("starts at most one automation job per window, across workers", async () => {
    const starts: number[] = [];
    const run = consumer(
      "automation",
      noting(() => starts.push(Date.now())),
      2,
    );
    const specs = { automation: { startEveryMs: 300 } };
    worker([run], { specs, pollMs: 100 });
    worker([run], { specs, pollMs: 100 });
    const q = new JobQueue(t.db, "automation");
    for (let n = 0; n < 3; n++) await q.add("check", { n }, { key: `c${String(n)}` });
    await vi.waitFor(() => {
      expect(starts).toHaveLength(3);
    });
    starts.sort((a, b) => a - b);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(250);
    expect((starts[2] ?? 0) - (starts[1] ?? 0)).toBeGreaterThanOrEqual(250);
  });

  it("never runs one job on two workers", async () => {
    const seen = new Map<number, number>();
    const run = consumer(
      "download",
      async (job) => {
        seen.set(job.data.n, (seen.get(job.data.n) ?? 0) + 1);
        await wait(5);
      },
      4,
    );
    worker([run]);
    worker([run]);
    const q = new JobQueue(t.db, "download");
    for (let n = 0; n < 30; n++) await q.add("fetch", { n }, { key: `k${String(n)}` });
    await vi.waitFor(async () => {
      expect(await liveJobs(t.db, "download")).toEqual([]);
    });
    expect(seen.size).toBe(30);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });

  it("renews a long job's lease, so the stall sweep leaves it alone", async () => {
    let runs = 0;
    worker(
      [
        consumer("download", async () => {
          runs++;
          await wait(900);
        }),
      ],
      { specs: { download: { leaseMs: 300 } } },
    );
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "long" });
    await vi.waitFor(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    for (let i = 0; i < 4; i++) {
      await wait(200);
      expect((await recoverStalled(t.db, logger)).requeued).toBe(0);
    }
    await vi.waitFor(async () => {
      expect(await liveJobs(t.db, "download")).toEqual([]);
    });
    expect(runs).toBe(1);
  });

  it("writes no outcome for a run that lost its job to another", async () => {
    worker([consumer("download", () => wait(300))]);
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "taken" });
    await vi.waitFor(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    await t.db
      .updateTable("jobs")
      .set({ locked_by: "00000000-0000-4000-8000-000000000001" })
      .where("key", "=", "taken")
      .execute();
    await wait(500);
    expect((await liveJobs(t.db, "download")).map((j) => j.state)).toEqual(["running"]);
  });

  it("drains: lets running jobs finish and starts nothing more", async () => {
    const done: number[] = [];
    const w = worker([
      consumer("download", async (job) => {
        await wait(200);
        done.push(job.data.n);
      }),
    ]);
    const q = new JobQueue(t.db, "download");
    await q.add("fetch", { n: 1 }, { key: "a" });
    await vi.waitFor(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    await q.add("fetch", { n: 2 }, { key: "b" });
    await w.drain();
    expect(done).toEqual([1]);
    expect((await liveJobs(t.db, "download")).map((j) => [j.key, j.state])).toEqual([
      ["b", "queued"],
    ]);
  });

  it("abandons: puts running jobs back as stalls, their attempt returned", async () => {
    const w = worker([consumer("download", () => wait(5000))]);
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "hung", attempts: 3 });
    await vi.waitFor(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    await w.abandon();
    const [job] = await liveJobs(t.db, "download");
    expect(job).toMatchObject({ state: "queued", attempts: 0, stalls: 1 });
  });
});
