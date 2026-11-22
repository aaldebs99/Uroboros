import { YtDlpError } from "./errors.ts";

/** Options every yt-dlp call takes. */
export interface YtDlpOptions {
  /** The yt-dlp executable; the worker passes `YTDLP_PATH`. Defaults to `yt-dlp` on PATH. */
  binary?: string;
  /** Extra arguments placed after the wrapper's own, before the URL. */
  extraArgs?: readonly string[];
  /**
   * A Netscape cookies file. yt-dlp rewrites the file it is given, so the wrapper hands it a
   * private copy and the original (a read-only Secret mount, say) is never written.
   */
  cookiesFile?: string;
  /** Kills the run after this many milliseconds; it then fails as `timed_out`. */
  timeoutMs?: number;
  /** Aborting kills the run; it then fails as `cancelled`. */
  signal?: AbortSignal;
  /** Variables set on top of this process's environment. */
  env?: Readonly<Record<string, string>>;
  /** How long a SIGTERM'd process group gets before SIGKILL. Defaults to 5 s. */
  killGraceMs?: number;
  /** How many redacted stderr lines an error keeps. Defaults to 20. */
  stderrTailLines?: number;
}

export const DEFAULT_BINARY = "yt-dlp";

/**
 * Arguments the wrapper never passes through: each one runs a command, reads arguments or
 * configuration from a file, or replaces the yt-dlp binary, none of which a job may do.
 */
const FORBIDDEN_LONG = [
  "--exec",
  "--exec-before-download",
  "--no-exec",
  "--batch-file",
  "--config-location",
  "--config-locations",
  "--load-info-json",
  "--netrc-cmd",
  "--update",
  "--update-to",
  "--plugin-dirs",
  "--cookies-from-browser",
] as const;
const FORBIDDEN_SHORT = ["-a", "-U"] as const;

function isForbidden(arg: string): boolean {
  if (arg.startsWith("--")) {
    const name = arg.split("=", 1)[0] ?? arg;
    return name.startsWith("--exec") || FORBIDDEN_LONG.some((flag) => flag === name);
  }
  return FORBIDDEN_SHORT.some((flag) => arg.startsWith(flag));
}

/** Throws `invalid_arguments` for an extra argument the wrapper refuses to pass. */
export function checkExtraArgs(args: readonly string[]): void {
  const bad = args.find(isForbidden);
  if (bad !== undefined) {
    throw new YtDlpError("invalid_arguments", `extra argument not allowed: ${bad}`);
  }
}

/** Parses `raw` and throws `invalid_url` unless it is an http(s) URL. */
export function checkUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new YtDlpError("invalid_url", "not a valid URL", { cause });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new YtDlpError(
      "invalid_url",
      `only http and https URLs are allowed, not ${url.protocol}`,
    );
  }
  return url.href;
}

/** The arguments every run starts with: no user config, no update check, no colour codes. */
export function baseArgs(cookiesPath: string | null): string[] {
  const args = ["--ignore-config", "--no-update", "--color", "never"];
  if (cookiesPath !== null) args.push("--cookies", cookiesPath);
  return args;
}

/** Assembles a full command line, the URL last and behind `--` so it is never an option. */
export function commandLine(
  cookiesPath: string | null,
  own: readonly string[],
  extra: readonly string[],
  url: string,
): string[] {
  return [...baseArgs(cookiesPath), ...own, ...extra, "--", url];
}
