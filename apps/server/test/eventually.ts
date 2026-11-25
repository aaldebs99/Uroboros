import { vi } from "vitest";

/**
 * How long a server test waits for something asynchronous (a NOTIFY's delivery, a job's pickup, a
 * process's exit) before failing. vitest's own default for `vi.waitFor` is 1000 ms, which a loaded
 * runner misses now and then: a full run clones databases and spawns fakes in every worker at once.
 * `expect.poll` gets the same timeout from vitest.config.ts.
 */
export const EVENTUALLY_MS = 5000;

/** `vi.waitFor` with this suite's timeout: retries `check` until it stops throwing. */
export function eventually<T>(
  check: () => T | Promise<T>,
  opts: { timeout?: number; interval?: number } = {},
): Promise<T> {
  return vi.waitFor(check, {
    timeout: opts.timeout ?? EVENTUALLY_MS,
    interval: opts.interval ?? 50,
  });
}
