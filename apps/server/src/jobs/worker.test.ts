import { sql } from "kysely";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testBus } from "../../test/bus.ts";
import { eventually } from "../../test/eventually.ts";
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
/** Every held processor's release, so a failed test's runs still end and its workers drain. */
const releases: (() => void)[] = [];
const logger = pino({ level: "silent" });

beforeEach(async () => {
  t = await TestDb.create();
  bus = testBus(t);
  await bus.ready;
});

afterEach(async () => {
  for (const release of releases.splice(0)) release();
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

/**
 * A processor the test lets finish: each run waits for `release()`, and `running` counts the
 * runs inside it. Ending a run on a timer instead races whatever the test does meanwhile.
 */
function held() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(() => {
    release();
  });
  const state = { running: 0, most: 0, done: [] as number[] };
  return {
    state,
    release: () => {
      release();
    },
    process: async (job: Job<{ n: number }>) => {
      state.running++;
      state.most = Math.max(state.most, state.running);
      await gate;
      state.running--;
      state.done.push(job.data.n);
    },
  };
}
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
    const started = Date.now();
    await new JobQueue(t.db, "probe").add("probe", { n: 1 });
    // Woken by the add, not found by its poll, which is a minute away.
    await eventually(() => {
      expect(seen).toEqual([1]);
    });
    expect(Date.now() - started).toBeLessThan(5000);
    await eventually(async () => {
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
      await eventually(() => {
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
    await eventually(() => {
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
    await eventually(
      () => {
        expect(runs).toHaveLength(3);
      },
      { timeout: 5000 },
    );
    expect(runs.map((r) => r.made)).toEqual([0, 1, 2]);
    expect((runs[1]?.at ?? 0) - (runs[0]?.at ?? 0)).toBeGreaterThanOrEqual(130);
    expect((runs[2]?.at ?? 0) - (runs[1]?.at ?? 0)).toBeGreaterThanOrEqual(280);
    await eventually(async () => {
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
    await eventually(async () => {
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
    await eventually(async () => {
      expect(made).toEqual([0, 0]);
      expect(await liveJobs(t.db, "playback")).toEqual([]);
    });
  });

  it("runs at most its concurrency at once", async () => {
    const h = held();
    worker([consumer("download", h.process, 2)]);
    const q = new JobQueue(t.db, "download");
    for (let n = 0; n < 6; n++) await q.add("fetch", { n }, { key: `k${String(n)}` });
    await eventually(() => {
      expect(h.state.running).toBe(2);
    });
    // Four more are waiting, and two runs are free to end: no third starts meanwhile.
    await wait(300);
    expect(h.state.most).toBe(2);
    h.release();
    await eventually(async () => {
      expect(await liveJobs(t.db, "download")).toEqual([]);
    });
    expect(h.state.most).toBe(2);
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
    await eventually(
      () => {
        expect(starts).toHaveLength(3);
      },
      { timeout: 5000 },
    );
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
    await eventually(async () => {
      expect(await liveJobs(t.db, "download")).toEqual([]);
    });
    expect(seen.size).toBe(30);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });

  it("renews a long job's lease, so the stall sweep leaves it alone", async () => {
    const h = held();
    // Renewed every 500 ms: a renewal can run 500 ms late before the lease lapses.
    worker([consumer("download", h.process)], { specs: { download: { leaseMs: 1000 } } });
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "long" });
    await eventually(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    // Two and a half leases long.
    for (let i = 0; i < 5; i++) {
      await wait(500);
      expect((await recoverStalled(t.db, logger)).requeued).toBe(0);
    }
    h.release();
    await eventually(async () => {
      expect(await liveJobs(t.db, "download")).toEqual([]);
    });
    expect(h.state.done).toEqual([1]);
  });

  it("writes no outcome for a run that lost its job to another", async () => {
    const h = held();
    const w = worker([consumer("download", h.process)]);
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "taken" });
    await eventually(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    await t.db
      .updateTable("jobs")
      .set({ locked_by: "00000000-0000-4000-8000-000000000001" })
      .where("key", "=", "taken")
      .execute();
    // The run ends only now, after the job changed hands; drain waits for it to finish.
    h.release();
    await w.drain();
    expect(h.state.done).toEqual([1]);
    expect((await liveJobs(t.db, "download")).map((j) => j.state)).toEqual(["running"]);
  });

  it("drains: lets running jobs finish and starts nothing more", async () => {
    const h = held();
    const w = worker([consumer("download", h.process)]);
    const q = new JobQueue(t.db, "download");
    await q.add("fetch", { n: 1 }, { key: "a" });
    await eventually(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    await q.add("fetch", { n: 2 }, { key: "b" });
    // Draining starts while "a" still runs, so nothing may claim "b" once "a" ends.
    const drained = w.drain();
    h.release();
    await drained;
    expect(h.state.done).toEqual([1]);
    expect((await liveJobs(t.db, "download")).map((j) => [j.key, j.state])).toEqual([
      ["b", "queued"],
    ]);
  });

  it("abandons: puts running jobs back as stalls, their attempt returned", async () => {
    const w = worker([consumer("download", () => wait(5000))]);
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "hung", attempts: 3 });
    await eventually(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    await w.abandon();
    const [job] = await liveJobs(t.db, "download");
    expect(job).toMatchObject({ state: "queued", attempts: 0, stalls: 1 });
  });
  it("tells a run that lost its lease to stop", async () => {
    let lost: AbortSignal | undefined;
    worker(
      [
        consumer("download", (job) => {
          lost = job.signal;
          return new Promise<void>((resolve) => {
            job.signal.addEventListener("abort", () => {
              resolve();
            });
          });
        }),
      ],
      { specs: { download: { leaseMs: 300 } } },
    );
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "lost" });
    await eventually(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    // Another run took the job (its lease lapsed and the sweep put it back, say).
    await t.db
      .updateTable("jobs")
      .set({ locked_by: "00000000-0000-4000-8000-000000000002" })
      .where("key", "=", "lost")
      .execute();
    await eventually(() => {
      expect(lost?.aborted).toBe(true);
    });
  });

  it("re-claiming a job its old run still holds here stops that run first, spending nothing", async () => {
    const runs: { made: number; aborted: boolean }[] = [];
    worker(
      [
        consumer(
          "download",
          (job) => {
            const run = { made: job.attemptsMade, aborted: false };
            runs.push(run);
            if (runs.length > 1) return Promise.resolve();
            return new Promise<void>((resolve) => {
              job.signal.addEventListener("abort", () => {
                run.aborted = true;
                setTimeout(resolve, 100);
              });
            });
          },
          2,
        ),
      ],
      { pollMs: 100 },
    );
    await new JobQueue(t.db, "download").add("fetch", { n: 1 }, { key: "twice", attempts: 3 });
    await eventually(async () => {
      expect((await liveJobs(t.db, "download"))[0]?.state).toBe("running");
    });
    // The lease lapses while the run is still alive (the database was away), and the sweep puts
    // the job back: this same worker claims it again.
    await sql`UPDATE jobs SET locked_until = now() - interval '1 second' WHERE key = 'twice'`.execute(
      t.db,
    );
    await recoverStalled(t.db, logger);
    await eventually(
      async () => {
        expect(await liveJobs(t.db, "download")).toEqual([]);
      },
      { timeout: 5000 },
    );
    expect(runs).toEqual([
      { made: 0, aborted: true },
      { made: 0, aborted: false },
    ]);
  });
});
