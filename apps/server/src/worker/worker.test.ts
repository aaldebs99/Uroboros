import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, connect } from "node:net";
import type { Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
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
    expect(done?.attemptsMade).toBe(1);
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
    const queueName = `main-${randomUUID()}`;
    const running = main([], { prefix, queueName });
    const key = `${prefix}:worker:${hostname()}:${String(process.pid)}`;
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

describe("process", () => {
  it("exits 1 within the grace deadline when a job hangs", async () => {
    const name = `proc-${randomUUID()}`;
    const { queue } = openQueue(name);
    const job = await queue.add("stuck", {});
    const serverDir = fileURLToPath(new URL("../..", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", "src/bin/worker.ts"], {
      cwd: serverDir,
      stdio: "ignore",
      env: {
        ...process.env,
        VALKEY_URL: TestValkey.url(),
        UROBOROS_WORKER_TEST_QUEUE: name,
        UROBOROS_WORKER_TEST_PREFIX: prefix,
        UROBOROS_WORKER_TEST_GRACE_MS: "500",
        UROBOROS_WORKER_TEST_HANG: "1",
      },
    });
    track(child, (c) => Promise.resolve(c.kill("SIGKILL")));
    const exited = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => {
        resolve(code);
      });
    });
    await vi.waitFor(async () => {
      expect(await job.getState()).toBe("active");
    }, WAIT);
    const t0 = Date.now();
    child.kill("SIGTERM");
    const code = await Promise.race([
      exited,
      new Promise<string>((r) =>
        setTimeout(() => {
          r("hung");
        }, 8000),
      ),
    ]);
    expect(code).toBe(1);
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});

describe("unreachable valkey", () => {
  it("still settles close() within the grace deadline", async () => {
    const upstream = new URL(TestValkey.url());
    const sockets = new Set<Socket>();
    const proxy = createServer((client) => {
      const up = connect(Number(upstream.port), upstream.hostname);
      sockets.add(client).add(up);
      client.pipe(up).pipe(client);
      client.on("error", () => undefined);
      up.on("error", () => undefined);
    });
    track(proxy, (p) => {
      p.close();
      for (const sock of sockets) sock.destroy();
      return Promise.resolve();
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const { port } = proxy.address() as AddressInfo;
    const worker = track(
      await start(
        { valkeyUrl: `redis://127.0.0.1:${String(port)}`, shutdownGraceMs: 1000 },
        `down-${randomUUID()}`,
      ),
      (w) => w.close().catch(() => undefined),
    );
    // Valkey goes away: stop accepting and cut every live connection.
    proxy.close();
    for (const s of sockets) s.destroy();
    const t0 = Date.now();
    await Promise.allSettled([worker.close()]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("main before ready", () => {
  it("returns 1 within the grace period when SIGTERM lands before Valkey answers", async () => {
    // Nothing listens on port 1, and the worker connection retries forever, so startup never
    // reaches ready on its own.
    vi.stubEnv("VALKEY_URL", "redis://127.0.0.1:1");
    const before = process.listenerCount("SIGTERM");
    const running = main([], {
      prefix,
      queueName: `unready-${randomUUID()}`,
      shutdownGraceMs: 500,
    });
    try {
      // The trap is installed once main has logged the tool versions; signal only after that.
      await vi.waitFor(() => {
        expect(process.listenerCount("SIGTERM")).toBeGreaterThan(before);
      }, WAIT);
      const t0 = Date.now();
      process.emit("SIGTERM");
      expect(await running).toBe(1);
      expect(Date.now() - t0).toBeLessThan(1500);
      expect(process.listenerCount("SIGTERM")).toBe(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("test seam validation", () => {
  it("rejects a non-integer grace with exit 2", async () => {
    vi.stubEnv("VALKEY_URL", TestValkey.url());
    vi.stubEnv("UROBOROS_WORKER_TEST_QUEUE", "x");
    vi.stubEnv("UROBOROS_WORKER_TEST_GRACE_MS", "abc");
    try {
      expect(await main()).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("loadWorkerConfig", () => {
  it("requires only VALKEY_URL", () => {
    expect(loadWorkerConfig({ VALKEY_URL: "redis://x:1" })).toEqual({
      valkeyUrl: "redis://x:1",
      concurrency: 4,
    });
    expect(() => loadWorkerConfig({})).toThrow(ConfigError);
  });

  it("reads UROBOROS_WORKER_CONCURRENCY", () => {
    const env = { VALKEY_URL: "redis://x:1", UROBOROS_WORKER_CONCURRENCY: "8" };
    expect(loadWorkerConfig(env).concurrency).toBe(8);
  });

  it.each(["0", "-1", "2.5", "abc", "", "4 "])("rejects concurrency %j", (bad) => {
    const env = { VALKEY_URL: "redis://x:1", UROBOROS_WORKER_CONCURRENCY: bad };
    expect(() => loadWorkerConfig(env)).toThrow(ConfigError);
  });
});
