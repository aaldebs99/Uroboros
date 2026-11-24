import { meaningfulLine, spawnStream } from "@uroboros/ytdlp";
import { Fmp4Reader, type Init } from "../transcode/fmp4.ts";
import { Segmenter } from "../transcode/segmenter.ts";

/** What a run hands its session (docs/transcoding.md). */
export interface RunHooks {
  onInit(bytes: Buffer): Promise<void>;
  /** A finished segment of the run (its index in the session's boundaries). */
  onSegment(index: number, bytes: Buffer): Promise<void>;
  /** Resolves when the run may read on: not reading pauses ffmpeg (throttling). */
  gate(): Promise<void>;
}

export interface RunOptions {
  binary: string;
  env?: Readonly<Record<string, string>>;
  args: readonly string[];
  boundaries: readonly number[];
  /** The segment the run starts at. */
  first: number;
  /** Seconds of pre-roll an audio file's later run starts with. */
  preroll?: number;
  signal: AbortSignal;
  hooks: RunHooks;
}

export interface RunOutcome {
  code: number | null;
  /** Ended by its signal (a restart, a stop, shutdown), not by ffmpeg. */
  stopped: boolean;
  /** Why ffmpeg failed, when it did. */
  error: string | null;
  /** Whether ffmpeg wrote anything (an init): a failure before is the pipeline's. */
  output: boolean;
  /** ffmpeg reached the end of the source and every segment it made was handed over. */
  reachedEnd: boolean;
  /** The last segment handed over, or null. */
  last: number | null;
}

/** The track whose fragments start on keyframes: the video, else the audio. */
function referenceTrack(init: Init): number {
  const tracks = [...init.tracks];
  const pick =
    tracks.find(([, t]) => t.kind === "vide") ?? tracks.find(([, t]) => t.kind === "soun");
  return pick?.[0] ?? 1;
}

/** Turns a run's bytes into the init and finished segments, handing each to the hooks. */
class RunReader {
  readonly #o: RunOptions;
  readonly #reader = new Fmp4Reader();
  #segmenter: Segmenter | null = null;
  output = false;
  last: number | null = null;

  constructor(o: RunOptions) {
    this.#o = o;
  }

  async push(chunk: Buffer): Promise<void> {
    for (const item of this.#reader.push(chunk)) {
      if (item.kind === "init") await this.#init(item);
      else if (this.#segmenter !== null) {
        for (const s of this.#segmenter.push(item)) await this.#hand(s.index, s.bytes);
      }
    }
  }

  /** The segment being made, now finished: ffmpeg ended at the end of the source. */
  async end(): Promise<void> {
    const last = this.#segmenter?.end();
    if (last) await this.#hand(last.index, last.bytes);
  }

  async #init(init: Init): Promise<void> {
    this.output = true;
    await this.#o.hooks.onInit(init.bytes);
    this.#segmenter = new Segmenter({
      boundaries: this.#o.boundaries,
      trackId: referenceTrack(init),
      first: this.#o.first,
      ...(this.#o.preroll === undefined ? {} : { preroll: this.#o.preroll }),
    });
  }

  async #hand(index: number, bytes: Buffer): Promise<void> {
    await this.#o.hooks.onSegment(index, bytes);
    this.last = index;
  }
}

/** Reads the run's stdout through the gate; the error a hook or a malformed stream threw, if any. */
async function readAll(stdout: AsyncIterable<Buffer>, o: RunOptions, reader: RunReader) {
  try {
    for await (const chunk of stdout) {
      await o.hooks.gate();
      if (o.signal.aborted) return null;
      await reader.push(chunk);
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * One ffmpeg run of a session: reads its fragmented MP4 as it comes, hands over the init and
 * each finished segment, and the last one only when ffmpeg ends at the end of the source.
 */
export async function runSegments(o: RunOptions): Promise<RunOutcome> {
  const p = spawnStream({
    binary: o.binary,
    args: o.args,
    ...(o.env === undefined ? {} : { env: o.env }),
    signal: o.signal,
  });
  const reader = new RunReader(o);
  const failure = await readAll(p.stdout, o, reader);
  if (failure !== null || o.signal.aborted) p.stop();
  const exit = await p.exited;
  if (failure !== null) throw failure;
  const stopped = exit.stopped || o.signal.aborted;
  const ok = exit.code === 0 && !stopped;
  if (ok) await reader.end();
  return {
    code: exit.code,
    stopped,
    error: ok || stopped ? null : meaningfulLine(exit.stderrTail),
    output: reader.output,
    reachedEnd: ok,
    last: reader.last,
  };
}
