import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "pino";

const run = promisify(execFile);

const VERSION_TIMEOUT_MS = 10_000;

export interface ToolPaths {
  /** Path to yt-dlp; `YTDLP_PATH` in the image, `yt-dlp` on PATH otherwise. */
  ytdlp: string;
  /** Path to ffmpeg. Default `ffmpeg` on PATH. */
  ffmpeg?: string;
}

async function firstLine(command: string, arg: string): Promise<string> {
  const { stdout } = await run(command, [arg], { timeout: VERSION_TIMEOUT_MS });
  return stdout.split("\n", 1)[0]?.trim() ?? "";
}

/**
 * Logs the yt-dlp and ffmpeg versions at worker startup. A missing or broken tool is a warning,
 * never a failure: crash-looping the pod would hide the cause, while a download job fails later
 * with a clear error. This is the only place a child process is spawned outside a job.
 */
export async function logToolVersions(log: Logger, paths: ToolPaths): Promise<void> {
  const tools: [name: string, command: string, arg: string][] = [
    ["yt-dlp", paths.ytdlp, "--version"],
    ["ffmpeg", paths.ffmpeg ?? "ffmpeg", "-version"],
  ];
  await Promise.all(
    tools.map(async ([tool, command, arg]) => {
      try {
        log.info({ tool, version: await firstLine(command, arg) }, "tool version");
      } catch (err) {
        log.warn({ err, tool, command }, "tool version unavailable; downloads will fail");
      }
    }),
  );
}
