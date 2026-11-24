/**
 * Runs jobs (docs/jobs.md): one runner per consumed queue claims due jobs up to its concurrency,
 * runs them, records how each ended, and renews the leases of those still running. It sleeps until
 * the next job is due (or the poll), and wakes early when the bus says a job was added, when the
 * listener reconnects, or when one of its slots frees.
 */
import { hostname } from "node:os";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { PgBus } from "../db/notifications.ts";
import type { Database } from "../db/schema.ts";
import { sleep } from "../shared/deadline.ts";
import { RequeueError, UnrecoverableError } from "./errors.ts";
import { QUEUES } from "./queues.ts";
import type { Job, Processor, QueueName, QueueSpec } from "./queues.ts";
import { claim, finish, nextWait, renew, requeue, retry, stallBack } from "./store.ts";
import type { ClaimedJob, Held } from "./store.ts";

export interface Consumer {
  queue: QueueName;
  /** Jobs of this queue run at once in this process. */
  concurrency: number;
  process: Processor<unknown>;
}

export interface JobWorkerOptions {
  db: Kysely<Database>;
  bus: PgBus;
  logger: Logger;
  consumers: readonly Consumer[];
  /** The longest sleep between looks for work. Default 5 s. */
  pollMs?: number;
  /** Who runs the jobs, for logs. Default host:pid. */
  worker?: string;
  /** Tests shorten leases and limits. */
  specs?: Partial<Record<QueueName, Partial<QueueSpec>>>;
}

export interface JobWorker {
  /** Stops claiming and waits for the running jobs to end, recording how each did. */
  drain(): Promise<void>;
  /** Stops claiming and puts the running jobs back at once, as stalls (a shutdown past its grace). */
  abandon(): Promise<void>;
}

const DEFAULT_POLL_MS = 5000;
/** The wait when a job is due but others hold it, or the limit holds it back. */
const BUSY_MS = 250;
const FIRST_ERROR_BACKOFF_MS = 1000;
const MAX_ERROR_BACKOFF_MS = 30_000;

export function startJobWorker(o: JobWorkerOptions): JobWorker {
  const runners = o.consumers.map(
    (c) => new QueueRunner(o, c, { ...QUEUES[c.queue], ...o.specs?.[c.queue] }),
  );
  const byQueue = new Map(runners.map((r) => [r.queue as string, r]));
  const wakeAll = () => {
    for (const r of runners) r.wake();
  };
  const offJobs = o.bus.on("uroboros_jobs", (queue) => byQueue.get(queue)?.wake());
  const offResync = o.bus.onResync(wakeAll);
  void o.bus.ready.then(wakeAll);
  for (const r of runners) r.start();
  return {
    async drain() {
      offJobs();
      offResync();
      await Promise.all(runners.map((r) => r.drain()));
    },
    async abandon() {
      offJobs();
      offResync();
      await Promise.all(runners.map((r) => r.abandon()));
    },
  };
}

interface Running extends Held {
  done: Promise<void>;
  /** Its outcome is being written: a renewal that misses it is no lost lease. */
  settling: boolean;
}

class QueueRunner {
  readonly queue: QueueName;
  readonly #db: Kysely<Database>;
  readonly #log: Logger;
  readonly #consumer: Consumer;
  readonly #spec: QueueSpec;
  readonly #pollMs: number;
  readonly #worker: string;
  readonly #running = new Map<string, Running>();
  readonly #stop = new AbortController();
  #nudge = new AbortController();
  #woken = false;
  #loop: Promise<void> = Promise.resolve();
  #renewTimer: NodeJS.Timeout | undefined;

  constructor(o: JobWorkerOptions, consumer: Consumer, spec: QueueSpec) {
    this.queue = consumer.queue;
    this.#db = o.db;
    this.#log = o.logger.child({ queue: consumer.queue });
    this.#consumer = consumer;
    this.#spec = spec;
    this.#pollMs = o.pollMs ?? DEFAULT_POLL_MS;
    this.#worker = o.worker ?? `${hostname()}:${String(process.pid)}`;
  }

  start(): void {
    this.#loop = this.#run();
    this.#renewTimer = setInterval(() => void this.#renew(), this.#spec.leaseMs / 2);
    this.#renewTimer.unref();
  }

  wake(): void {
    this.#woken = true;
    this.#nudge.abort();
  }

  async drain(): Promise<void> {
    this.#stop.abort();
    await this.#loop;
    await Promise.all([...this.#running.values()].map((r) => r.done));
    clearInterval(this.#renewTimer);
  }

  async abandon(): Promise<void> {
    this.#stop.abort();
    clearInterval(this.#renewTimer);
    await this.#loop;
    const held = [...this.#running.values()].map(({ id, token }) => ({ id, token }));
    const back = await stallBack(this.#db, held);
    if (back.length > 0) this.#log.warn({ jobs: back.length }, "put running jobs back unfinished");
  }

  /** Read through methods: a stop or a wake can land during any await. */
  #stopped(): boolean {
    return this.#stop.signal.aborted;
  }

  #wasWoken(): boolean {
    return this.#woken;
  }

  async #run(): Promise<void> {
    let backoff = FIRST_ERROR_BACKOFF_MS;
    while (!this.#stopped()) {
      this.#woken = false;
      const free = this.#consumer.concurrency - this.#running.size;
      if (free <= 0) {
        await this.#rest(this.#pollMs);
        continue;
      }
      let claimed: ClaimedJob[];
      try {
        claimed = await claim(this.#db, this.queue, {
          limit: free,
          leaseMs: this.#spec.leaseMs,
          worker: this.#worker,
          ...(this.#spec.startEveryMs === undefined
            ? {}
            : { startEveryMs: this.#spec.startEveryMs }),
        });
        backoff = FIRST_ERROR_BACKOFF_MS;
      } catch (err) {
        this.#log.error({ err }, "could not claim jobs");
        await this.#rest(backoff);
        backoff = Math.min(backoff * 2, MAX_ERROR_BACKOFF_MS);
        continue;
      }
      if (this.#stopped()) {
        await this.#giveBack(claimed);
        return;
      }
      for (const job of claimed) this.#launch(job);
      const mayBeMore = claimed.length === free && this.#spec.startEveryMs === undefined;
      if (mayBeMore || this.#wasWoken()) continue;
      await this.#rest(await this.#waitMs());
    }
  }

  async #waitMs(): Promise<number> {
    try {
      const wait = await nextWait(this.#db, this.queue);
      if (wait === null) return this.#pollMs;
      return wait <= 0 ? BUSY_MS : Math.min(wait, this.#pollMs);
    } catch (err) {
      this.#log.warn({ err }, "could not tell when the next job is due");
      return this.#pollMs;
    }
  }

  /** Sleeps up to `ms`, or until woken or stopped. */
  async #rest(ms: number): Promise<void> {
    if (this.#woken) return;
    this.#nudge = new AbortController();
    await sleep(ms, AbortSignal.any([this.#nudge.signal, this.#stop.signal]));
  }

  #launch(job: ClaimedJob): void {
    const entry: Running = {
      id: job.id,
      token: job.locked_by,
      done: Promise.resolve(),
      settling: false,
    };
    entry.done = this.#runOne(job, entry)
      .catch((err: unknown) => {
        this.#log.error({ err, name: job.name, key: job.key }, "a job's outcome was not recorded");
      })
      .finally(() => {
        this.#running.delete(job.id);
        this.wake();
      });
    this.#running.set(job.id, entry);
  }

  async #runOne(job: ClaimedJob, entry: Running): Promise<void> {
    const view: Job<unknown> = {
      id: job.id,
      queue: job.queue,
      name: job.name,
      key: job.key,
      data: job.data,
      attemptsMade: job.attempts - 1,
      opts: { attempts: job.max_attempts },
    };
    let failure: { err: unknown } | undefined;
    try {
      await this.#consumer.process(view);
    } catch (err) {
      failure = { err };
    }
    entry.settling = true;
    const kept =
      failure === undefined
        ? await finish(this.#db, entry)
        : await this.#settle(job, entry, failure.err);
    if (!kept)
      this.#log.warn({ name: job.name, key: job.key }, "a job's run lost it before ending");
  }

  /** Records a failed run: back to the queue, a retry, or dropped. False when the run lost the job. */
  async #settle(job: ClaimedJob, held: Held, err: unknown): Promise<boolean> {
    if (err instanceof RequeueError) return requeue(this.#db, held, err.delayMs);
    if (err instanceof UnrecoverableError || job.attempts >= job.max_attempts) {
      this.#log.warn({ err, name: job.name, key: job.key, attempts: job.attempts }, "job failed");
      return finish(this.#db, held);
    }
    return retry(this.#db, held, err instanceof Error ? err.message : String(err));
  }

  /** Jobs claimed after a stop began go straight back, their attempt unspent. */
  async #giveBack(claimed: readonly ClaimedJob[]): Promise<void> {
    for (const job of claimed) await requeue(this.#db, { id: job.id, token: job.locked_by }, 0);
  }

  async #renew(): Promise<void> {
    const held = [...this.#running.values()].map(({ id, token }) => ({ id, token }));
    if (held.length === 0) return;
    try {
      const renewed = await renew(this.#db, this.#spec.leaseMs, held);
      for (const h of held) {
        const entry = this.#running.get(h.id);
        if (!renewed.has(h.id) && entry !== undefined && !entry.settling) {
          this.#log.warn({ id: h.id }, "a running job lost its lease");
        }
      }
    } catch (err) {
      this.#log.warn({ err }, "could not renew job leases");
    }
  }
}
