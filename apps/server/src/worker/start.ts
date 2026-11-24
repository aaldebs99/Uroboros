import { pino } from "pino";
import type { Logger } from "pino";
import type { DownloadWorkers } from "./downloadWorkers.ts";

/** How long a stopping process waits for its running jobs. */
export const DEFAULT_SHUTDOWN_GRACE_MS = 25_000;
/** Before the grace runs out, running fetches and playback runs are cut and requeued. */
const ABORT_MARGIN_MS = 5000;
/** How long putting unfinished jobs back may take once the grace is spent. */
const ABANDON_MS = 1000;

export interface StartWorkerOptions {
  /** Starts the consumers (docs/jobs.md); it may take a while (the GPU self-test runs first). */
  consumers: () => Promise<DownloadWorkers>;
  /** Hard deadline for `close()`; keep it under the container's stop timeout. Default 25000. */
  shutdownGraceMs?: number;
  logger?: Logger;
  /**
   * Aborts a start whose consumers are still being prepared: `startWorker` rejects with
   * `StartupAborted`, and consumers that come up later are drained in the background.
   */
  abort?: AbortSignal;
}

/** `startWorker` was aborted before its consumers were running. */
export class StartupAborted extends Error {
  constructor() {
    super("worker startup aborted before it was ready");
    this.name = "StartupAborted";
  }
}

/** Resolves true if `signal` aborts before `p` settles, false once `p` resolves; rejects with `p`. */
function abortedFirst(p: Promise<unknown>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise<boolean>((resolve, reject) => {
    const onAbort = () => {
      resolve(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve(false);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export interface RunningWorker {
  /**
   * Stops taking jobs and waits for the running ones (cutting fetches and playback runs shortly
   * before the grace ends). Past `shutdownGraceMs` it puts the jobs still running back in their
   * queues, as stalls, and rejects, so the caller can exit non-zero instead of hanging.
   */
  close(): Promise<void>;
}

/** Awaits `p` for at most `ms`, swallowing its failure and its timeout. */
async function bestEffort(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      p.catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Starts the job consumers. Installs no process handlers; the caller owns shutdown. */
export async function startWorker(opts: StartWorkerOptions): Promise<RunningWorker> {
  const log = opts.logger ?? pino({ name: "uroboros" });
  const graceMs = opts.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const starting = opts.consumers();
  starting.catch(() => undefined); // may settle after an abort; the race below reports the outcome
  if (opts.abort !== undefined && (await abortedFirst(starting, opts.abort))) {
    void starting.then(
      (late) =>
        bestEffort(
          late.jobs.drain().then(() => late.close()),
          graceMs,
        ),
      () => undefined,
    );
    throw new StartupAborted();
  }
  const consumers = await starting;
  log.info("job consumers started");

  let closing: Promise<void> | undefined;
  const closeOnce = async () => {
    // Short jobs finish on their own; a long download or playback run is cut near the deadline
    // and requeued.
    const cut = setTimeout(
      () => {
        consumers.abortRunning();
      },
      Math.max(0, graceMs - ABORT_MARGIN_MS),
    );
    let deadline: NodeJS.Timeout | undefined;
    const expired = new Promise<"timeout">((resolve) => {
      deadline = setTimeout(() => {
        resolve("timeout");
      }, graceMs);
    });
    try {
      const drain = (async () => {
        await consumers.jobs.drain();
        await consumers.close();
      })();
      drain.catch(() => undefined); // may settle after the deadline; the race reports the outcome
      const outcome = await Promise.race([drain.then(() => "closed" as const), expired]);
      if (outcome === "timeout") {
        // Jobs still running go back at once, as stalls, for another replica.
        await bestEffort(consumers.jobs.abandon(), ABANDON_MS);
        throw new Error(`worker did not drain within ${String(graceMs)} ms; jobs put back`);
      }
    } finally {
      clearTimeout(cut);
      clearTimeout(deadline);
    }
  };
  return {
    close() {
      closing ??= closeOnce();
      return closing;
    },
  };
}
