import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Queue, QueueEvents } from "bullmq";
import type { Processor } from "bullmq";
import { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestValkey } from "../../test/testValkey.ts";
import { ConfigError, loadWorkerConfig } from "../config.ts";
import { createValkey } from "../shared/valkey.ts";
import { main, startWorker } from "./main.ts";
import type { RunningWorker } from "./main.ts";
import { QUEUE_NAMES } from "./queues.ts";
import { createSystemWorker } from "./system.ts";

const WAIT = { timeout: 15_000, interval: 50 };

let prefix: string;
let cleanup: (() => Promise<unknown>)[];
let redis: Redis;

/** Registers a resource to be closed in afterEach (reverse order). */
function track<T>(resource: T, close: (r: T) => Promise<unknown>): T {
  cleanup.push(() => close(resource));
  return resource;
}

function disconnect(client: Redis): Promise<void> {
  client.disconnect();
  return Promise.resolve();
}

function openQueue(name: string): { queue: Queue; events: QueueEvents } {
  const connection = createValkey(TestValkey.url(), "worker");
  track(connection, disconnect);
  const queue = track(new Queue(name, { connection, prefix }), (q) => q.close());
  const events = track(new QueueEvents(name, { connection: connection.duplicate(), prefix }), (e) =>
    e.close(),
  );
  return { queue, events };
}

beforeEach(() => {
  prefix = `test-${randomUUID()}`;
  cleanup = [];
  redis = new Redis(TestValkey.url());
});

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  redis.disconnect();
});

function start(
  extra: Partial<Parameters<typeof startWorker>[0]> = {},
  name: string = QUEUE_NAMES.system,
): Promise<RunningWorker> {
  return startWorker({
    valkeyUrl: TestValkey.url(),
    concurrency: 2,
    prefix,
    queueName: name,
    ...extra,
  });
}

describe("system queue", () => {
  it("answers ping with pong", async () => {
    const worker = track(await start(), (w) => w.close());
    expect(worker.heartbeatKey.startsWith(`${prefix}:worker:`)).toBe(true);
    const { queue, events } = openQueue(QUEUE_NAMES.system);
    await events.waitUntilReady();
    const job = await queue.add("ping", { at: new Date().toISOString() });
    await expect(job.waitUntilFinished(events, 15_000)).resolves.toEqual({ pong: true });
  });

  it("writes a heartbeat key with a TTL of at most 30 s", async () => {
    const worker = track(await start(), (w) => w.close());
    expect(worker.heartbeatKey).toBe(`${prefix}:worker:${hostname()}:${String(process.pid)}`);
    expect(await redis.exists(worker.heartbeatKey)).toBe(1);
    const ttl = await redis.ttl(worker.heartbeatKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it("refreshes the heartbeat and removes it on close", async () => {
    const worker = await start({ heartbeatEveryMs: 100 });
    await redis.expire(worker.heartbeatKey, 5);
    await vi.waitFor(async () => {
      expect(await redis.ttl(worker.heartbeatKey)).toBeGreaterThan(5);
    }, WAIT);
    await worker.close();
    expect(await redis.exists(worker.heartbeatKey)).toBe(0);
  });
});

describe("shutdown", () => {
  it("lets an active job finish and leaves later jobs waiting", async () => {
    const name = `graceful-${randomUUID()}`;
    let started = false;
    const processor: Processor = async () => {
      started = true;
      await new Promise((r) => setTimeout(r, 500));
      return { done: true };
    };
    // concurrency 1: an idle slot's in-flight fetch may still grab a job right as close() begins.
    const worker = await start({ processor, concurrency: 1 }, name);
    const { queue, events } = openQueue(name);
    await events.waitUntilReady();
    const job = await queue.add("slow", {});
    await vi.waitFor(() => {
      expect(started).toBe(true);
    }, WAIT);

    const closing = worker.close();
    const later = await queue.add("late", {});
    await closing;

    expect(await job.getState()).toBe("completed");
    expect((await queue.getJob(job.id ?? ""))?.returnvalue).toEqual({ done: true });
    expect(await later.getState()).toBe("waiting");
  });

  it("force closes and rejects when draining outlives shutdownGraceMs", async () => {
    const name = `stuck-${randomUUID()}`;
    let started = false;
    const processor: Processor = () => {
      started = true;
      return new Promise(() => undefined);
    };
    const worker = await start({ processor, shutdownGraceMs: 300 }, name);
    const { queue } = openQueue(name);
    await queue.add("stuck", {});
    await vi.waitFor(() => {
      expect(started).toBe(true);
    }, WAIT);
    const t0 = Date.now();
    await expect(worker.close()).rejects.toThrow(/did not drain/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("crash", () => {
  it("re-runs a job whose worker was killed, so processors must be idempotent", async () => {
    const name = `crash-${randomUUID()}`;
    let runs = 0;
    const processor: Processor = async () => {
      runs += 1;
      if (runs === 1) await new Promise(() => undefined); // worker A hangs, then is killed
      return { runs };
    };
    const connA = createValkey(TestValkey.url(), "worker");
    track(connA, disconnect);
    const workerA = createSystemWorker(connA, {
      prefix,
      concurrency: 1,
      queueName: name,
      processor,
      // A's own stalled check sets the shared 'stalled-check' key for this long, so keep it short.
      stalledInterval: 500,
      lockDuration: 1000,
    });
    track(workerA, (w) => w.close(true));
    await workerA.waitUntilReady();

    const { queue, events } = openQueue(name);
    await events.waitUntilReady();
    const job = await queue.add("long", {});
    await vi.waitFor(() => {
      expect(runs).toBe(1);
    }, WAIT);
    await workerA.close(true); // simulated kill: no graceful drain, lock not released

    const workerB = track(
      await start({ processor, stalledInterval: 500, lockDuration: 1000 }, name),
      (w) => w.close(),
    );
    expect(workerB.heartbeatKey).toBeTruthy();
    await expect(job.waitUntilFinished(events, 20_000)).resolves.toEqual({ runs: 2 });

    const done = await queue.getJob(job.id ?? "");
    expect(runs).toBe(2);
    expect(done?.attemptsStarted).toBe(2);
    expect(done?.stalledCounter).toBe(1);
  });
});

describe("main", () => {
  it("returns 2 when VALKEY_URL is missing", async () => {
    vi.stubEnv("VALKEY_URL", "");
    try {
      expect(await main()).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("runs until SIGTERM, then resolves 0 and removes its heartbeat", async () => {
    vi.stubEnv("VALKEY_URL", TestValkey.url());
    const running = main();
    const key = `uroboros:worker:${hostname()}:${String(process.pid)}`;
    try {
      await vi.waitFor(async () => {
        expect(await redis.exists(key)).toBe(1);
      }, WAIT);
      process.emit("SIGTERM");
      expect(await running).toBe(0);
      expect(await redis.exists(key)).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("loadWorkerConfig", () => {
  it("requires only VALKEY_URL", () => {
    expect(loadWorkerConfig({ VALKEY_URL: "redis://x:1" })).toEqual({ valkeyUrl: "redis://x:1" });
    expect(() => loadWorkerConfig({})).toThrow(ConfigError);
  });
});
