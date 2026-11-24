import { type Fragment, presentationTime } from "./fmp4.ts";
import { segmentAt } from "./timeline.ts";

/** A keyframe this close before a boundary counts as on it (timestamp rounding). */
const EPSILON = 0.001;

export interface SegmentOut {
  index: number;
  bytes: Buffer;
}

export interface SegmenterOptions {
  /** The session's boundaries (timeline.ts). */
  boundaries: readonly number[];
  /** The track whose fragments start on keyframes: the video, or the audio of an audio file. */
  trackId: number;
  /** The segment this run started at; anything before it is dropped. */
  first: number;
}

/**
 * Puts one run's fragments into the session's segments by the reference track's presentation
 * time: ffmpeg starts a fragment at every keyframe, and the boundaries are keyframes, so each
 * segment is a whole number of fragments. A segment is finished when the next one begins.
 */
export class Segmenter {
  readonly #o: SegmenterOptions;
  #index: number | null = null;
  #parts: Buffer[] = [];

  constructor(options: SegmenterOptions) {
    this.#o = options;
  }

  /** The segment being filled, or null before the run reaches its first. */
  get current(): number | null {
    return this.#index;
  }

  push(f: Fragment): SegmentOut[] {
    const t = presentationTime(f, this.#o.trackId);
    if (t === null) {
      if (this.#index !== null) this.#parts.push(f.bytes);
      return [];
    }
    const at = t + EPSILON;
    if (at < (this.#o.boundaries[this.#o.first] as number)) return [];
    const index = segmentAt(this.#o.boundaries, at);
    if (index === this.#index) {
      this.#parts.push(f.bytes);
      return [];
    }
    const done = this.end();
    this.#index = index;
    this.#parts = [f.bytes];
    return done === null ? [] : [done];
  }

  /** The segment being filled, as it is: call once the run has ended at the end of the video. */
  end(): SegmentOut | null {
    if (this.#index === null || this.#parts.length === 0) return null;
    const out = { index: this.#index, bytes: Buffer.concat(this.#parts) };
    this.#parts = [];
    return out;
  }
}
