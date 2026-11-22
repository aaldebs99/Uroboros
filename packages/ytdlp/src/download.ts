import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  checkExtraArgs,
  checkUrl,
  commandLine,
  DEFAULT_BINARY,
  type YtDlpOptions,
} from "./args.ts";
import { removePartialFiles } from "./cleanup.ts";
import { withCookiesCopy } from "./cookies.ts";
import { YtDlpError } from "./errors.ts";
import { VideoInfo } from "./info.ts";
import {
  checkRun,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_STDERR_TAIL_LINES,
  runProcess,
  stoppedError,
  type RunResult,
} from "./process.ts";
import {
  MARKER,
  parseMarkedLine,
  REPORTING_ARGS,
  type FinishedFile,
  type ProgressEvent,
} from "./progress.ts";

export interface DownloadOptions extends YtDlpOptions {
  /** The job's scratch directory (absolute): yt-dlp's working directory and output home. */
  workDir: string;
  /** A yt-dlp format selector (`-f`), such as `bv*[height<=1080]+ba/b`. */
  format: string;
  /** The output template (`-o`), relative to `workDir`. Defaults to `%(id)s.%(ext)s`. */
  outputTemplate?: string;
  /**
   * Receives every progress event, in order. If it throws, the download still runs to the end
   * and then rejects with that error.
   */
  onProgress?: (event: ProgressEvent) => void;
}

export interface DownloadedFile {
  videoId: string | null;
  /** Absolute path of the final file. */
  path: string;
  /** Absolute path of the `.info.json` yt-dlp wrote beside it. */
  infoJsonPath: string;
  /** That `.info.json`, validated. */
  info: VideoInfo;
}

export interface DownloadResult {
  /** One per downloaded video: one for a video, one per entry for a playlist. */
  files: DownloadedFile[];
  /** The last stderr lines (warnings, say), redacted. */
  stderrTail: string[];
}

export const DEFAULT_OUTPUT_TEMPLATE = "%(id)s.%(ext)s";

function invalidOutput(message: string, result: RunResult, cause?: unknown): YtDlpError {
  return new YtDlpError("invalid_output", message, {
    cause,
    exitCode: result.exitCode,
    stderrTail: result.stderrTail,
  });
}

async function readInfo(
  workDir: string,
  file: FinishedFile,
  result: RunResult,
): Promise<DownloadedFile> {
  if (file.infoJsonPath === null) {
    throw invalidOutput(`yt-dlp wrote no .info.json for ${file.path}`, result);
  }
  const infoJsonPath = resolve(workDir, file.infoJsonPath);
  try {
    const info = VideoInfo.parse(JSON.parse(await readFile(infoJsonPath, "utf8")));
    return { videoId: file.videoId, path: resolve(workDir, file.path), infoJsonPath, info };
  } catch (cause) {
    throw invalidOutput(`unreadable .info.json at ${infoJsonPath}`, result, cause);
  }
}

/** Collects the marked lines of both streams: progress to the callback, files to a list. */
class Reporter {
  readonly files: FinishedFile[] = [];
  callbackError: { error: unknown } | null = null;

  private readonly onProgress: ((event: ProgressEvent) => void) | undefined;

  constructor(onProgress: ((event: ProgressEvent) => void) | undefined) {
    this.onProgress = onProgress;
  }

  readonly line = (line: string): void => {
    const parsed = parseMarkedLine(line);
    if (parsed === null) return;
    if (parsed.type === "file") {
      this.files.push(parsed.file);
      return;
    }
    if (this.onProgress === undefined || this.callbackError !== null) return;
    try {
      this.onProgress(parsed.event);
    } catch (error) {
      this.callbackError = { error };
    }
  };
}

/**
 * Downloads `url` (a video, or every entry of a playlist or channel) into `options.workDir` with
 * the given format selector and output template, writing an `.info.json` beside each file.
 * Resolves with the final files once yt-dlp has exited cleanly. A cancel or timeout kills the
 * process group and removes the partial files before rejecting.
 */
export async function download(url: string, options: DownloadOptions): Promise<DownloadResult> {
  const target = checkUrl(url);
  const extra = options.extraArgs ?? [];
  checkExtraArgs(extra);
  if (!isAbsolute(options.workDir)) {
    throw new YtDlpError("invalid_arguments", "workDir must be an absolute path");
  }
  const own = [
    "--format",
    options.format,
    "--output",
    options.outputTemplate ?? DEFAULT_OUTPUT_TEMPLATE,
    "--paths",
    options.workDir,
    "--write-info-json",
    ...REPORTING_ARGS,
  ];
  const reporter = new Reporter(options.onProgress);
  const result = await withCookiesCopy(options.cookiesFile, (cookies) =>
    runProcess({
      binary: options.binary ?? DEFAULT_BINARY,
      args: commandLine(cookies, own, extra, target),
      cwd: options.workDir,
      env: options.env,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      stderrTailLines: options.stderrTailLines ?? DEFAULT_STDERR_TAIL_LINES,
      onStdoutLine: reporter.line,
      onStderrLine: reporter.line,
      keepInTail: (line) => !line.startsWith(MARKER),
    }),
  );
  if (result.stopped !== null) {
    await removePartialFiles(options.workDir);
    throw stoppedError(result.stopped, result);
  }
  checkRun(result);
  if (reporter.callbackError !== null) throw reporter.callbackError.error;
  const files = await Promise.all(
    reporter.files.map((file) => readInfo(options.workDir, file, result)),
  );
  return { files, stderrTail: result.stderrTail };
}
