import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { checkUrl, commandLine, DEFAULT_BINARY, runtimeArgs, type YtDlpOptions } from "./args.ts";
import { DEFAULT_OUTPUT_TEMPLATE } from "./download.ts";
import { YtDlpError } from "./errors.ts";
import { normalizeExtraArgs } from "./flags.ts";
import { VideoInfo } from "./info.ts";
import {
  checkRun,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_STDERR_TAIL_LINES,
  runProcess,
  stoppedError,
} from "./process.ts";
import { secretsOf, withRunFiles } from "./runFiles.ts";

export interface SubtitlesOptions extends YtDlpOptions {
  /** The job's scratch directory (absolute): yt-dlp's working directory and output home. */
  workDir: string;
}

export interface SubtitlesResult {
  /** The video's `.info.json`, which says which languages are automatic captions. */
  info: VideoInfo;
  /** Its absolute path: the subtitles are `<the same name, less .info.json>.<lang>.vtt`. */
  infoJsonPath: string;
  /** Absolute paths of the subtitle files yt-dlp wrote (`<id>.<lang>.vtt`), sorted. */
  files: string[];
}

/**
 * Fetches a video's subtitles alone (`--skip-download`), as `extraArgs` ask for them (the
 * subtitle flags a fetch would add), into `options.workDir` beside its `.info.json`: what a
 * download that a site's rate limit kept them from goes back for.
 */
export async function downloadSubtitles(
  url: string,
  options: SubtitlesOptions,
): Promise<SubtitlesResult> {
  const target = checkUrl(url);
  const extra = normalizeExtraArgs(options.extraArgs ?? []);
  if (!isAbsolute(options.workDir)) {
    throw new YtDlpError("invalid_arguments", "workDir must be an absolute path");
  }
  const own = [
    "--skip-download",
    "--write-info-json",
    "--output",
    DEFAULT_OUTPUT_TEMPLATE,
    "--paths",
    options.workDir,
    ...runtimeArgs(options.jsRuntime),
  ];
  const result = await withRunFiles(options, (files) =>
    runProcess({
      binary: options.binary ?? DEFAULT_BINARY,
      args: commandLine(files, own, extra, target),
      secrets: secretsOf(options),
      cwd: options.workDir,
      env: options.env,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      stderrTailLines: options.stderrTailLines ?? DEFAULT_STDERR_TAIL_LINES,
    }),
  );
  if (result.stopped !== null) throw stoppedError(result.stopped, result);
  checkRun(result);
  const names = (await readdir(options.workDir)).sort();
  const infoName = names.find((n) => n.endsWith(".info.json"));
  const details = { exitCode: result.exitCode, stderrTail: result.stderrTail };
  if (infoName === undefined) {
    throw new YtDlpError("invalid_output", "yt-dlp wrote no .info.json", details);
  }
  const infoJsonPath = join(options.workDir, infoName);
  let info: VideoInfo;
  try {
    info = VideoInfo.parse(JSON.parse(await readFile(infoJsonPath, "utf8")));
  } catch (cause) {
    throw new YtDlpError("invalid_output", `unreadable .info.json ${infoName}`, {
      ...details,
      cause,
    });
  }
  const files = names.filter((n) => n.endsWith(".vtt")).map((n) => join(options.workDir, n));
  return { info, infoJsonPath, files };
}
