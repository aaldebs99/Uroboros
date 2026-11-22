import { getEventListeners } from "node:events";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { type LeaderLock, LeaderGuard, LeaderStatus, leadAndRun } from "./leader.ts";

const logger = pino({ level: "silent" });

/** Hands out scripted answers: a lose-controller for a win, `null` when another replica leads. */
class FakeLock implements LeaderLock {
  attempts = 0;
  released = 0;
  constructor(private readonly answers: (AbortController | null)[]) {}
  tryAcquire(): Promise<LeaderGuard | null> {
    this.attempts++;
    const next = this.answers.shift() ?? null;
    if (next === null) return Promise.resolve(null);
    return Promise.resolve(
      new LeaderGuard(next.signal, () => {
        this.released++;
        return Promise.resolve();
      }),
    );
  }
}

/** Counts runs; each run ends when its signal aborts. */
function idleWork() {
  const runs = { count: 0 };
  const work = (signal: AbortSignal) => {
    runs.count++;
    return new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    });
  };
  return { runs, work };
}

describe("leadAndRun", () => {
  it("waits for the lock, then runs the work as leader", async () => {
    const lock = new FakeLock([null, null, new AbortController()]);
    const { runs, work } = idleWork();
    const status = new LeaderStatus();
    const shutdown = new AbortController();
    const loop = leadAndRun({
      lock,
      name: "test",
      work,
      shutdown: shutdown.signal,
      retryMs: 20,
      status,
      logger,
    });
    await vi.waitFor(() => {
      expect(runs.count).toBe(1);
    });
    expect(lock.attempts).toBeGreaterThanOrEqual(3);
    expect(status.leading).toBe(true);
    shutdown.abort();
    await loop;
    expect(status.leading).toBe(false);
    expect(lock.released).toBe(1);
  });

  it("stops the work when the lock is lost, then retries and leads again", async () => {
    const first = new AbortController();
    const lock = new FakeLock([first, new AbortController()]);
    const { runs, work } = idleWork();
    const status = new LeaderStatus();
    const shutdown = new AbortController();
    const loop = leadAndRun({
      lock,
      name: "test",
      work,
      shutdown: shutdown.signal,
      retryMs: 20,
      status,
      logger,
    });
    await vi.waitFor(() => {
      expect(runs.count).toBe(1);
    });
    first.abort();
    await vi.waitFor(() => {
      expect(runs.count).toBe(2);
    });
    expect(status.leading).toBe(true);
    shutdown.abort();
    await loop;
    expect(lock.released).toBe(2);
  });

  it("lets shutdown win over the retry wait", async () => {
    const lock = new FakeLock([]);
    const { runs, work } = idleWork();
    const status = new LeaderStatus();
    const shutdown = new AbortController();
    const loop = leadAndRun({
      lock,
      name: "test",
      work,
      shutdown: shutdown.signal,
      retryMs: 30_000,
      status,
      logger,
    });
    await vi.waitFor(() => {
      expect(lock.attempts).toBe(1);
    });
    const start = Date.now();
    shutdown.abort();
    await loop;
    expect(Date.now() - start).toBeLessThan(1000);
    expect(runs.count).toBe(0);
    expect(status.leading).toBe(false);
  });

  it("retries a lock that cannot be reached", async () => {
    let attempts = 0;
    const lock: LeaderLock = {
      tryAcquire() {
        attempts++;
        return attempts < 3
          ? Promise.reject(new Error("unreachable"))
          : Promise.resolve(new LeaderGuard(new AbortController().signal, () => Promise.resolve()));
      },
    };
    const { runs, work } = idleWork();
    const shutdown = new AbortController();
    const loop = leadAndRun({
      lock,
      name: "test",
      work,
      shutdown: shutdown.signal,
      retryMs: 10,
      status: new LeaderStatus(),
      logger,
    });
    await vi.waitFor(() => {
      expect(runs.count).toBe(1);
    });
    shutdown.abort();
    await loop;
  });

  it("stops for good when the work fails, releasing the lock", async () => {
    const lock = new FakeLock([new AbortController(), new AbortController()]);
    const status = new LeaderStatus();
    let runs = 0;
    await leadAndRun({
      lock,
      name: "test",
      work: () => {
        runs++;
        return Promise.reject(new Error("broken duty"));
      },
      shutdown: new AbortController().signal,
      retryMs: 10,
      status,
      logger,
    });
    expect(runs).toBe(1);
    expect(lock.attempts).toBe(1);
    expect(lock.released).toBe(1);
    expect(status.leading).toBe(false);
  });

  it("status follows the lock", async () => {
    const lose = new AbortController();
    const lock = new FakeLock([lose]);
    const { work } = idleWork();
    const status = new LeaderStatus();
    const seen: boolean[] = [];
    status.onChange((leading) => {
      seen.push(leading);
    });
    const shutdown = new AbortController();
    const loop = leadAndRun({
      lock,
      name: "test",
      work,
      shutdown: shutdown.signal,
      retryMs: 10,
      status,
      logger,
    });
    await vi.waitFor(() => {
      expect(status.leading).toBe(true);
    });
    lose.abort();
    await vi.waitFor(() => {
      expect(status.leading).toBe(false);
    });
    shutdown.abort();
    await loop;
    expect(seen).toEqual([true, false]);
  });

  it("leaves no listener on the shutdown signal behind, however often it retries", async () => {
    const lock = new FakeLock([]);
    const shutdown = new AbortController();
    const loop = leadAndRun({
      lock,
      name: "test",
      work: idleWork().work,
      shutdown: shutdown.signal,
      retryMs: 1,
      status: new LeaderStatus(),
      logger,
    });
    await vi.waitFor(() => {
      expect(lock.attempts).toBeGreaterThanOrEqual(10);
    });
    const early = getEventListeners(shutdown.signal, "abort").length;
    await vi.waitFor(() => {
      expect(lock.attempts).toBeGreaterThanOrEqual(300);
    });
    expect(getEventListeners(shutdown.signal, "abort").length).toBe(early);
    expect(early).toBeLessThanOrEqual(2);
    shutdown.abort();
    await loop;
  });

  it("clears the status before giving the lock back", async () => {
    const status = new LeaderStatus();
    const leadingAtRelease: boolean[] = [];
    let finishRelease: () => void = () => undefined;
    const lock: LeaderLock = {
      tryAcquire: () =>
        Promise.resolve(
          new LeaderGuard(new AbortController().signal, () => {
            leadingAtRelease.push(status.leading);
            return new Promise<void>((resolve) => {
              finishRelease = resolve;
            });
          }),
        ),
    };
    const shutdown = new AbortController();
    const loop = leadAndRun({
      lock,
      name: "test",
      work: idleWork().work,
      shutdown: shutdown.signal,
      retryMs: 10,
      status,
      logger,
    });
    await vi.waitFor(() => {
      expect(status.leading).toBe(true);
    });
    shutdown.abort();
    await vi.waitFor(() => {
      expect(leadingAtRelease).toEqual([false]);
    });
    // Still releasing (a silent server), yet no longer reported as leader.
    expect(status.leading).toBe(false);
    finishRelease();
    await loop;
  });
});
