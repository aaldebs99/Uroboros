import { Writable } from "node:stream";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testBus } from "../../test/bus.ts";
import { eventually } from "../../test/eventually.ts";
import { liveJobs } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import type { PgBus } from "../db/notifications.ts";
import { JobQueue } from "../jobs/queues.ts";
import { startJobWorker } from "../jobs/worker.ts";
import type { Consumer } from "../jobs/worker.ts";
import type { DownloadWorkers } from "./downloadWorkers.ts";
import { StartupAborted, startWorker } from "./start.ts";

let t: TestDb;
let bus: PgBus;
const silent = pino({ level: "silent" });

beforeEach(async () => {
  t = await TestDb.create();
  bus = testBus(t);
  await bus.ready;
});

afterEach(async () => {
  await bus.close();
  await t.close();
});

/** Consumers of the download queue, one job at a time, with `process` and a cut that counts. */
function consumers(process: Consumer["process"], onCut: () => void = () => undefined) {
  return (): Promise<DownloadWorkers> => {
    const jobs = startJobWorker({
      db: t.db,
      bus,
      logger: silent,
      consumers: [{ queue: "download", concurrency: 1, process }],
      pollMs: 100,
    });
    return Promise.resolve({ jobs, abortRunning: onCut, close: () => Promise.resolve() });
  };
}

const add = (key: string) => new JobQueue(t.db, "download").add("fetch", { key }, { key });
const running = async () =>
  eventually(async () => {
    expect((await liveJobs(t.db, "download")).some((j) => j.state === "running")).toBe(true);
  });

describe("startWorker", () => {
  it("says when its consumers have started", async () => {
    const lines: string[] = [];
    const logger = pino(
      new Writable({
        write(chunk: Buffer, _enc, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
    );
    const w = await startWorker({ consumers: consumers(() => Promise.resolve()), logger });
    expect(lines.some((l) => l.includes("job consumers started"))).toBe(true);
    await w.close();
  });

  it("closes once the running job ends, leaving later jobs queued", async () => {
    let release: () => void = () => undefined;
    const w = await startWorker({
      logger: silent,
      consumers: consumers(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    });
    await add("a");
    await running();
    await add("b");
    const closed = w.close();
    setTimeout(() => {
      release();
    }, 100);
    await closed;
    expect((await liveJobs(t.db, "download")).map((j) => [j.key, j.state])).toEqual([
      ["b", "queued"],
    ]);
  });

  it("gives up within its grace when a job hangs, putting the job back", async () => {
    const w = await startWorker({
      logger: silent,
      shutdownGraceMs: 400,
      consumers: consumers(() => new Promise<void>(() => undefined)),
    });
    await add("hung");
    await running();
    const started = Date.now();
    await expect(w.close()).rejects.toThrow(/did not drain within 400 ms/);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(await liveJobs(t.db, "download")).toMatchObject([{ state: "queued", stalls: 1 }]);
  });

  it("cuts running jobs before its grace runs out", async () => {
    const cut = new AbortController();
    const w = await startWorker({
      logger: silent,
      shutdownGraceMs: 300,
      consumers: consumers(
        () =>
          new Promise<void>((resolve) => {
            cut.signal.addEventListener("abort", () => {
              resolve();
            });
          }),
        () => {
          cut.abort();
        },
      ),
    });
    await add("long");
    await running();
    await w.close();
    expect(cut.signal.aborted).toBe(true);
  });

  it("cuts 5 s before the grace runs out, not sooner, and never a job that ended first", async () => {
    let cutAt = 0;
    const cut = new AbortController();
    const w = await startWorker({
      logger: silent,
      // The cut comes at 5600 - 5000 = 600 ms into the close.
      shutdownGraceMs: 5600,
      consumers: consumers(
        () =>
          new Promise<void>((resolve) => {
            cut.signal.addEventListener("abort", () => {
              resolve();
            });
          }),
        () => {
          cutAt = Date.now();
          cut.abort();
        },
      ),
    });
    await add("long");
    await running();
    const closing = Date.now();
    await w.close();
    expect(cutAt - closing).toBeGreaterThanOrEqual(550);
    expect(cutAt - closing).toBeLessThan(3000);

    // A job that ends well before the cut is left to finish: nothing is cut.
    let cuts = 0;
    let release: () => void = () => undefined;
    const quick = await startWorker({
      logger: silent,
      shutdownGraceMs: 5600,
      consumers: consumers(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
        () => {
          cuts++;
        },
      ),
    });
    await add("short");
    await running();
    const closed = quick.close();
    release();
    await closed;
    // Past the moment the cut would have come.
    await new Promise((r) => setTimeout(r, 800));
    expect(cuts).toBe(0);
  });

  it("gives up a start whose consumers are still preparing when it is aborted", async () => {
    const abort = new AbortController();
    const starting = startWorker({
      logger: silent,
      shutdownGraceMs: 300,
      abort: abort.signal,
      consumers: () => new Promise<DownloadWorkers>(() => undefined),
    });
    setTimeout(() => {
      abort.abort();
    }, 50);
    await expect(starting).rejects.toBeInstanceOf(StartupAborted);
  });
});
