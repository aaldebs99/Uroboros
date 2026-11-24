import { spawn, type ChildProcess } from "node:child_process";
import { YtDlpError } from "./errors.ts";
import { LineSplitter, LineTail } from "./lines.ts";
import { DEFAULT_KILL_GRACE_MS, DEFAULT_STDERR_TAIL_LINES } from "./process.ts";
import { redactLine } from "./redact.ts";

/**
 * A process whose stdout is binary and read as it comes: a playback session's ffmpeg
 * (docs/transcoding.md). Not reading its stdout makes ffmpeg block on the pipe, which is how a
 * session throttles a run that is far ahead of its viewer.
 */
export interface StreamOptions {
  binary: string;
  args: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  killGraceMs?: number;
  stderrTailLines?: number;
}

export interface StreamExit {
  code: number | null;
  /** Whether `stop()` (or the signal) ended it. */
  stopped: boolean;
  /** The last stderr lines, redacted. */
  stderrTail: string[];
}

export interface StreamProcess {
  readonly stdout: AsyncIterable<Buffer>;
  /** Settles once the process has exited and its output is drained; rejects if it never started. */
  readonly exited: Promise<StreamExit>;
  /** SIGTERM to the process group, then SIGKILL after the grace period. */
  stop(): void;
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ESRCH: the group is already gone.
  }
}

export function spawnStream(o: StreamOptions): StreamProcess {
  const child = spawn(o.binary, o.args, {
    cwd: o.cwd,
    env: { ...process.env, ...o.env },
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = new LineSplitter();
  const tail = new LineTail(o.stderrTailLines ?? DEFAULT_STDERR_TAIL_LINES);
  const keep = (line: string) => {
    tail.push(redactLine(line));
  };
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    lines.push(chunk).forEach(keep);
  });
  let stopped = false;
  let grace: NodeJS.Timeout | undefined;
  const stop = () => {
    if (stopped || child.exitCode !== null) return;
    stopped = true;
    killGroup(child, "SIGTERM");
    grace = setTimeout(() => {
      killGroup(child, "SIGKILL");
    }, o.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
  };
  if (o.signal?.aborted === true) stop();
  o.signal?.addEventListener("abort", stop, { once: true });
  const exited = new Promise<StreamExit>((resolve, reject) => {
    child.once("error", (cause) => {
      o.signal?.removeEventListener("abort", stop);
      reject(new YtDlpError("spawn_failed", `could not start ${o.binary}`, { cause }));
    });
    child.once("exit", () => {
      // Whatever a stopped process left running in its group goes too.
      if (stopped) killGroup(child, "SIGKILL");
    });
    child.once("close", (code: number | null) => {
      clearTimeout(grace);
      o.signal?.removeEventListener("abort", stop);
      lines.flush().forEach(keep);
      resolve({ code, stopped, stderrTail: tail.get() });
    });
  });
  // A failed start is reported through `exited`; the stream just ends.
  exited.catch(() => undefined);
  return { stdout: child.stdout, exited, stop };
}

/** ffmpeg's closing lines, which say that it failed but not why. */
const GENERIC = [
  /Conversion failed!/,
  /Terminating thread with return code/,
  /Task finished with error code/,
  /Nothing was written into output file/,
  /Error while filtering/,
  /Could not open encoder before EOF/,
  /Error while processing the decoded data/,
  /Error opening output files?/,
];
const COMPONENT = /^\[(?:Parsed_)?([A-Za-z0-9_]+?)(?:_\d+)? @ 0x[0-9a-f]+\]\s*/;

/**
 * The stderr line that says why ffmpeg failed: the last one that is not a generic closing line,
 * prefixed with the filter or codec that wrote it (`tonemap_cuda: …`).
 */
export function meaningfulLine(tail: readonly string[]): string {
  const found = [...tail].reverse().find((line) => !GENERIC.some((g) => g.test(line)));
  const line = found ?? tail.at(-1);
  if (line === undefined) return "ffmpeg failed";
  const m = COMPONENT.exec(line);
  return m === null ? line.trim() : `${m[1] ?? ""}: ${line.slice(m[0].length).trim()}`;
}
