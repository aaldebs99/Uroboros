import {
  checkRun,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_STDERR_TAIL_LINES,
  runProcess,
} from "./process.ts";
import { inputArgs } from "./ffprobe.ts";

export interface KeyframeOptions {
  binary?: string;
  /** The video stream's absolute index. */
  streamIndex: number;
  /** The container's start time (ffprobe's `format.start_time`), subtracted from every time. */
  startTime?: number | null;
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * The video's keyframe times in seconds from the file's start, sorted: what a remux can cut at
 * (docs/transcoding.md). Read from the packets, so nothing is decoded; still a pass over the whole
 * file, so the fetch consumer does it once while the file is on local disk.
 */
export async function probeKeyframes(input: string, o: KeyframeOptions): Promise<number[]> {
  const times = new Set<number>();
  const offset = o.startTime ?? 0;
  const result = await runProcess({
    binary: o.binary ?? "ffprobe",
    args: [
      "-v",
      "error",
      "-select_streams",
      String(o.streamIndex),
      "-show_entries",
      "packet=pts_time,flags",
      "-of",
      "csv=p=0",
      ...inputArgs(input),
    ],
    env: o.env,
    signal: o.signal,
    timeoutMs: o.timeoutMs,
    killGraceMs: DEFAULT_KILL_GRACE_MS,
    stderrTailLines: DEFAULT_STDERR_TAIL_LINES,
    onStdoutLine: (line) => {
      const [pts, flags] = line.split(",");
      const t = Number(pts);
      if (flags?.startsWith("K") === true && Number.isFinite(t)) {
        times.add(Math.max(0, Math.round((t - offset) * 1e6) / 1e6));
      }
    },
  });
  checkRun(result);
  return [...times].sort((a, b) => a - b);
}
