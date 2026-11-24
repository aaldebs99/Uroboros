import { AUDIO_PREROLL_SECONDS, type Pipeline, sessionArgs } from "@uroboros/ytdlp";
import type { PlaybackSessionEncoder } from "../db/schema.ts";
import type { BusMessage } from "../transcode/bus.ts";
import { choosePipeline, encoderOf, pipelinesFor, sourceKey } from "../transcode/hwaccel.ts";
import { runPlanFor } from "../transcode/runPlan.ts";
import { LIVE, type SessionRow, type StoredPlan } from "../transcode/sessions.ts";
import { segmentAt } from "../transcode/timeline.ts";
import type { WorkerDeps } from "./deps.ts";
import { type RunHooks, runSegments } from "./sessionRun.ts";
import { type PreparedSource, readInput, SessionError } from "./sessionSource.ts";
import { FencedError, InitChangedError, type SessionWriter } from "./sessionWriter.ts";

export interface SessionTimings {
  /** How often the runner checks its viewer is still there (and the session still live). */
  aliveCheckMs: number;
  /** A want is acted on after this quiet time, so a scrub settles first. */
  debounceMs: number;
  /** A want more than this many segments past what the run has made restarts it there. */
  restartAhead: number;
  /** The run pauses this many segments ahead of the newest want… */
  throttleAhead: number;
  /** …and reads on once the player is this close again. */
  resumeAhead: number;
  /** This many already-stored segments in a row make the run jump past them. */
  skipStored: number;
  /** Failures after output tolerated before the session fails. */
  retries: number;
}

export const DEFAULT_TIMINGS: SessionTimings = {
  aliveCheckMs: 5000,
  debounceMs: 250,
  restartAhead: 4,
  throttleAhead: 20,
  resumeAhead: 10,
  skipStored: 5,
  retries: 2,
};

export type LoopEnd =
  | { kind: "stopped" }
  | { kind: "shutdown" }
  | { kind: "fenced" }
  | { kind: "failed"; error: string };

interface Run {
  first: number;
  /** The last segment this run handed over. */
  produced: number;
  ac: AbortController;
  restartAt: number | null;
  /** Already-stored segments in a row. */
  storedInRow: number;
  skippedToEnd: boolean;
}

export interface LoopOptions {
  deps: WorkerDeps;
  row: SessionRow;
  plan: StoredPlan;
  source: PreparedSource;
  writer: SessionWriter;
  timings: SessionTimings;
}

/**
 * A session's runs (docs/transcoding.md): from the viewer's position to the end, restarted where
 * the player asks when that is far from what the run is making, paused when far ahead of it,
 * moved down the GPU-to-CPU chain when a pipeline fails at once, and idle once the end is made
 * until the player asks for a segment no run made.
 */
export class SessionLoop {
  readonly #o: LoopOptions;
  #ended: LoopEnd | null = null;
  #run: Run | null = null;
  /** The newest segment the player asked for. */
  #newest: number;
  #gateWaiter: (() => void) | null = null;
  #idleWaiter: ((n: number | null) => void) | null = null;
  #debounce: NodeJS.Timeout | undefined;
  #pipeline: Pipeline;
  /**
   * Pipelines that failed at once in this session. Remembered for the replica only when one below
   * them then works on this source (otherwise the file, the store or a limit was at fault).
   */
  #suspects: Pipeline[] = [];
  #retries = 0;

  constructor(o: LoopOptions) {
    this.#o = o;
    this.#newest = segmentAt(o.source.boundaries, o.plan.start);
    this.#pipeline = this.#choose();
  }

  get #segments(): number {
    return this.#o.source.boundaries.length - 1;
  }

  #chain(): Pipeline[] {
    const t = this.#o.deps.transcoder;
    return pipelinesFor(t.hwaccel, t.gpuWorks);
  }

  #choose(): Pipeline {
    const v = this.#o.source.video;
    if (this.#o.plan.mode !== "encode" || v === null) return "cpu";
    return choosePipeline(this.#chain(), this.#o.deps.transcoder.memo, sourceKey(v));
  }

  #encoder(): PlaybackSessionEncoder | null {
    const { plan } = this.#o;
    if (plan.mode === "remux") return "copy";
    if (plan.mode === "audio") return plan.audio === "copy" ? "copy" : null;
    return encoderOf(this.#pipeline);
  }

  /** A message for this session from the bus. */
  onMessage(m: BusMessage): void {
    if (m.t === "stop") {
      this.end({ kind: "stopped" });
      return;
    }
    if (m.t !== "want") return;
    if (m.n >= 0) this.#newest = m.n;
    this.#wakeGate();
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#decide(m.n).catch((err: unknown) => {
        this.#o.deps.logger.warn({ err, sid: this.#o.row.id }, "could not act on a playback want");
      });
    }, this.#o.timings.debounceMs);
  }

  /** Ends the loop (a stop, the viewer gone, shutdown, a failure); the current run is killed. */
  end(e: LoopEnd): void {
    if (this.#ended !== null) return;
    this.#ended = e;
    clearTimeout(this.#debounce);
    this.#run?.ac.abort();
    this.#idleWaiter?.(null);
    this.#gateWaiter?.();
  }

  async run(): Promise<LoopEnd> {
    let next: number | null = this.#newest;
    while (this.#ended === null) {
      next = next === null ? await this.#idle() : await this.#step(next);
    }
    return this.#ended;
  }

  /** A want: restart for a segment far from the run, or start one when idle. */
  async #decide(n: number): Promise<void> {
    if (this.#ended !== null || n < 0 || (await this.#o.writer.isStored(n))) return;
    const run = this.#run;
    if (run === null) {
      this.#idleWaiter?.(n);
      return;
    }
    if (n < run.first || n > run.produced + this.#o.timings.restartAhead) {
      this.#o.deps.logger.info({ sid: this.#o.row.id, from: run.first, to: n }, "playback restart");
      run.restartAt = n;
      run.ac.abort();
      this.#wakeGate();
    }
  }

  /** Waits for a want of a segment nobody made; null when the loop ends. */
  async #idle(): Promise<number | null> {
    const missing = await this.#nextUnstored(this.#newest);
    if (missing === this.#newest) return missing;
    return new Promise((resolve) => {
      if (this.#ended !== null) {
        resolve(null);
        return;
      }
      this.#idleWaiter = (n) => {
        this.#idleWaiter = null;
        resolve(n);
      };
    });
  }

  /** One run from `first`; where to go next (null: idle). */
  async #step(first: number): Promise<number | null> {
    const run: Run = {
      first,
      produced: first - 1,
      ac: new AbortController(),
      restartAt: null,
      storedInRow: 0,
      skippedToEnd: false,
    };
    this.#run = run;
    let outcome;
    try {
      outcome = await runSegments(await this.#runOptions(run));
    } catch (err) {
      this.#endOnError(err);
      return null;
    } finally {
      this.#run = null;
    }
    if (this.#ended !== null) return null;
    if (run.restartAt !== null) return run.restartAt;
    if (outcome.reachedEnd || run.skippedToEnd) return null;
    if (!outcome.output) return this.#fallBack(first, outcome.error);
    return this.#retry(run, outcome.error);
  }

  async #runOptions(run: Run) {
    const { deps, plan, source } = this.#o;
    const t = deps.transcoder;
    // Asked for every run: an S3 URL presigned for an earlier run may have expired.
    const input = await readInput(deps, source.key);
    this.#o.deps.logger.info(
      { sid: this.#o.row.id, first: run.first, pipeline: this.#pipeline, mode: plan.mode },
      "playback run",
    );
    const args = sessionArgs(
      runPlanFor({
        input,
        plan,
        streams: source.streams,
        boundaries: source.boundaries,
        first: run.first,
        pipeline: this.#pipeline,
        vaapiDevice: t.vaapiDevice,
      }),
    );
    return {
      binary: t.ffmpeg.binary,
      ...(t.ffmpeg.env === undefined ? {} : { env: t.ffmpeg.env }),
      args,
      boundaries: source.boundaries,
      first: run.first,
      ...(plan.mode === "audio" && run.first > 0 ? { preroll: AUDIO_PREROLL_SECONDS } : {}),
      signal: run.ac.signal,
      hooks: this.#hooks(run),
    };
  }

  #hooks(run: Run): RunHooks {
    return {
      onInit: async (bytes) => {
        await this.#o.writer.init(bytes);
        this.#rememberSuspects();
        await this.#markRunning();
      },
      onSegment: async (n, bytes) => {
        const fresh = await this.#o.writer.segment(n, bytes);
        run.produced = n;
        this.#wakeGate();
        if (fresh) {
          run.storedInRow = 0;
          return;
        }
        if (++run.storedInRow < this.#o.timings.skipStored) return;
        const next = await this.#nextUnstored(n + 1);
        // A want that already asked for a restart elsewhere wins over the jump.
        if (run.restartAt === null) {
          if (next === null) run.skippedToEnd = true;
          else run.restartAt = next;
        }
        run.ac.abort();
      },
      gate: () => this.#gate(run),
    };
  }

  async #markRunning(): Promise<void> {
    await this.#o.deps.db
      .updateTable("playback_sessions")
      .set({ state: "running", encoder: this.#encoder() })
      .where("id", "=", this.#o.row.id)
      .where("state", "in", LIVE)
      .execute();
  }

  /** Pauses the run while it is far ahead of the player. */
  #gate(run: Run): Promise<void> {
    if (run.ac.signal.aborted || run.produced - this.#newest < this.#o.timings.throttleAhead) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#gateWaiter = () => {
        this.#gateWaiter = null;
        resolve();
      };
    });
  }

  #wakeGate(): void {
    const run = this.#run;
    const near = run === null || run.produced - this.#newest <= this.#o.timings.resumeAhead;
    if (run?.ac.signal.aborted === true || near) this.#gateWaiter?.();
  }

  async #nextUnstored(from: number): Promise<number | null> {
    for (let n = Math.max(0, from); n < this.#segments; n++) {
      if (!(await this.#o.writer.isStored(n))) return n;
    }
    return null;
  }

  /** A pipeline that failed before any output: the next one down the chain, or the session fails. */
  #fallBack(first: number, error: string | null): number | null {
    const v = this.#o.source.video;
    if (this.#o.plan.mode === "encode" && v !== null && this.#pipeline !== "cpu") {
      this.#suspects.push(this.#pipeline);
      const memo = this.#o.deps.transcoder.memo;
      const key = sourceKey(v);
      const next =
        this.#chain().find(
          (p) => p === "cpu" || (!memo.failed(p, key) && !this.#suspects.includes(p)),
        ) ?? "cpu";
      this.#o.deps.logger.warn(
        { sid: this.#o.row.id, failed: this.#pipeline, next, error },
        "playback pipeline failed; falling back",
      );
      this.#pipeline = next;
      return first;
    }
    this.end({ kind: "failed", error: error ?? "ffmpeg failed" });
    return null;
  }

  /** A pipeline below the ones that failed works on this source: they are this replica's fault. */
  #rememberSuspects(): void {
    const v = this.#o.source.video;
    if (v === null || this.#suspects.length === 0) return;
    for (const p of this.#suspects) {
      this.#o.deps.transcoder.memo.markFailed(p, sourceKey(v));
      this.#o.deps.logger.warn(
        { pipeline: p, source: sourceKey(v) },
        "remembering a pipeline that fails on this kind of source",
      );
    }
    this.#suspects = [];
  }

  /** A run that failed after output: again from the next segment it did not make, a few times. */
  async #retry(run: Run, error: string | null): Promise<number | null> {
    if (++this.#retries > this.#o.timings.retries) {
      this.end({ kind: "failed", error: error ?? "ffmpeg failed" });
      return null;
    }
    this.#o.deps.logger.warn({ sid: this.#o.row.id, error }, "playback run failed; retrying");
    return this.#nextUnstored(run.produced + 1);
  }

  #endOnError(err: unknown): void {
    if (err instanceof FencedError) this.end({ kind: "fenced" });
    else if (err instanceof InitChangedError || err instanceof SessionError) {
      this.end({ kind: "failed", error: err.message });
    } else {
      this.#o.deps.logger.error({ err, sid: this.#o.row.id }, "playback run broke");
      this.end({ kind: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
}
