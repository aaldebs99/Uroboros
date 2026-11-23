import { checkUrl, commandLine, DEFAULT_BINARY, type YtDlpOptions } from "./args.ts";
import { withCookiesCopy } from "./cookies.ts";
import { YtDlpError } from "./errors.ts";
import { normalizeExtraArgs } from "./flags.ts";
import { parseInfo, type ProbeResult } from "./info.ts";
import {
  checkRun,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_STDERR_TAIL_LINES,
  runProcess,
  type RunResult,
} from "./process.ts";

export interface ProbeOptions extends YtDlpOptions {
  /**
   * List a playlist's or channel's entries without resolving each one (`--flat-playlist`): one
   * page fetch instead of one per entry, at the cost of stub entries.
   */
  flat?: boolean;
}

function parseJson(text: string, result: RunResult): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new YtDlpError("invalid_output", "yt-dlp printed something other than JSON", {
      cause,
      exitCode: result.exitCode,
      stderrTail: result.stderrTail,
    });
  }
}

/**
 * Asks yt-dlp what is behind `url` (a video, a playlist or a channel) without downloading it, and
 * returns the validated, typed answer.
 */
export async function probe(url: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const target = checkUrl(url);
  const extra = normalizeExtraArgs(options.extraArgs ?? []);
  const own = ["--dump-single-json", "--no-warnings", "--no-progress"];
  if (options.flat === true) own.push("--flat-playlist");
  return withCookiesCopy(options.cookiesFile, async (cookies) => {
    const result = await runProcess({
      binary: options.binary ?? DEFAULT_BINARY,
      args: commandLine(cookies, own, extra, target),
      env: options.env,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      stderrTailLines: options.stderrTailLines ?? DEFAULT_STDERR_TAIL_LINES,
    });
    const json = parseJson(checkRun(result), result);
    try {
      return parseInfo(json);
    } catch (cause) {
      throw new YtDlpError("invalid_output", "yt-dlp's JSON is not an info document", {
        cause,
        exitCode: result.exitCode,
        stderrTail: result.stderrTail,
      });
    }
  });
}
