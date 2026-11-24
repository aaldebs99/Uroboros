import { spawn, type ChildProcess } from "node:child_process";
import { LineSplitter, LineTail } from "./lines.ts";
import { redactLine } from "./redact.ts";
import { classifyFailure, failureMessage, YtDlpError } from "./errors.ts";

/** Why the wrapper stopped a run itself, or null when the process ended on its own. */
export type StopReason = "cancelled" | "timed_out" | "output_too_large";

export interface RunOptions {
  binary: string;
  args: readonly string[];
  cwd?: string | undefined;
  env?: Readonly<Record<string, string>> | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  killGraceMs: number;
  stderrTailLines: number;
  /** Receives stdout line by line; without it stdout is collected whole into `stdout`. */
  onStdoutLine?: (line: string) => void;
  /** Decides which stderr lines the tail keeps (all by default). */
  keepInTail?: (line: string) => boolean;
  /** Strings (saved passwords) blanked wherever they appear in the kept stderr lines. */
  secrets?: readonly string[];
  /** Receives every raw (unredacted) stderr line. */
  onStderrLine?: (line: string) => void;
  /** The cap on collected stdout, in UTF-16 code units. Defaults to 128 Mi. */
  maxStdout?: number;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  /** The last stderr lines, redacted. */
  stderrTail: string[];
  stopped: StopReason | null;
}

const DEFAULT_MAX_STDOUT = 128 * 1024 * 1024;

/** Signals the whole process group, so yt-dlp's ffmpeg children go with it. */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ESRCH: the group is already gone.
  }
}

/** One spawned process: its output plumbing, its stop timers and its settlement. */
class Run {
  private readonly stdoutLines = new LineSplitter();
  private readonly stderrLines = new LineSplitter();
  private readonly tail: LineTail;
  private readonly options: RunOptions;
  private readonly child: ChildProcess;
  private stdout = "";
  private stopped: StopReason | null = null;
  private graceTimer: NodeJS.Timeout | undefined;
  private timeoutTimer: NodeJS.Timeout | undefined;
  private readonly onAbort = (): void => {
    this.stop("cancelled");
  };

  constructor(options: RunOptions, child: ChildProcess) {
    this.options = options;
    this.child = child;
    this.tail = new LineTail(options.stderrTailLines);
  }

  start(resolve: (result: RunResult) => void, reject: (error: Error) => void): void {
    const { child, options } = this;
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      this.onStdout(chunk);
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      this.stderrLines.push(chunk).forEach(this.onStderrLine);
    });
    options.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (options.timeoutMs !== undefined) {
      this.timeoutTimer = setTimeout(() => {
        this.stop("timed_out");
      }, options.timeoutMs);
    }
    child.once("exit", () => {
      // Whatever the stopped process left running in its group goes too.
      if (this.stopped !== null) killGroup(child, "SIGKILL");
    });
    child.once("error", (cause) => {
      this.cleanup();
      reject(new YtDlpError("spawn_failed", `could not start ${options.binary}`, { cause }));
    });
    child.once("close", (code: number | null) => {
      this.cleanup();
      this.finishStreams();
      resolve({
        exitCode: code,
        stdout: this.stdout,
        stderrTail: this.tail.get(),
        stopped: this.stopped,
      });
    });
  }

  private onStdout(chunk: string): void {
    const { onStdoutLine } = this.options;
    if (onStdoutLine !== undefined) {
      this.stdoutLines.push(chunk).forEach((line) => {
        onStdoutLine(line);
      });
      return;
    }
    if (this.stdout.length + chunk.length > (this.options.maxStdout ?? DEFAULT_MAX_STDOUT)) {
      this.stop("output_too_large");
      return;
    }
    this.stdout += chunk;
  }

  private readonly onStderrLine = (line: string): void => {
    if (this.options.keepInTail?.(line) ?? true) {
      this.tail.push(redactLine(line, this.options.secrets));
    }
    this.options.onStderrLine?.(line);
  };

  private finishStreams(): void {
    const { onStdoutLine } = this.options;
    if (onStdoutLine !== undefined) {
      this.stdoutLines.flush().forEach((line) => {
        onStdoutLine(line);
      });
    }
    this.stderrLines.flush().forEach(this.onStderrLine);
  }

  private stop(reason: StopReason): void {
    if (this.stopped !== null) return;
    this.stopped = reason;
    killGroup(this.child, "SIGTERM");
    this.graceTimer = setTimeout(() => {
      killGroup(this.child, "SIGKILL");
    }, this.options.killGraceMs);
  }

  private cleanup(): void {
    clearTimeout(this.graceTimer);
    clearTimeout(this.timeoutTimer);
    this.options.signal?.removeEventListener("abort", this.onAbort);
  }
}

/**
 * Spawns `binary` with `args` (never through a shell) as the leader of a new process group, and
 * resolves once it has exited and its output is drained. A cancel or timeout sends the group
 * SIGTERM, then SIGKILL after `killGraceMs`; the result says which stopped it. Only a failure to
 * start rejects.
 */
export function runProcess(options: RunOptions): Promise<RunResult> {
  if (options.signal?.aborted === true) {
    return Promise.reject(new YtDlpError("cancelled", "cancelled before start"));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(options.binary, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    new Run(options, child).start(resolve, reject);
  });
}

/** The error for a run the wrapper stopped itself. */
export function stoppedError(reason: StopReason, result: RunResult): YtDlpError {
  const details = { exitCode: result.exitCode, stderrTail: result.stderrTail };
  switch (reason) {
    case "cancelled":
      return new YtDlpError("cancelled", "cancelled", details);
    case "timed_out":
      return new YtDlpError("timed_out", "timed out", details);
    case "output_too_large":
      return new YtDlpError("invalid_output", "output exceeded the size cap", details);
  }
}

export const DEFAULT_KILL_GRACE_MS = 5000;
export const DEFAULT_STDERR_TAIL_LINES = 20;

/** Turns a finished run into its stdout, or throws the error it ended with. */
export function checkRun(result: RunResult): string {
  if (result.stopped !== null) throw stoppedError(result.stopped, result);
  if (result.exitCode !== 0) {
    throw new YtDlpError(
      classifyFailure(result.exitCode, result.stderrTail),
      failureMessage(result.exitCode, result.stderrTail),
      { exitCode: result.exitCode, stderrTail: result.stderrTail },
    );
  }
  return result.stdout;
}
