import { YtDlpError } from "./errors.ts";

/** Options every yt-dlp call takes. */
export interface YtDlpOptions {
  /** The yt-dlp executable; the worker passes `YTDLP_PATH`. Defaults to `yt-dlp` on PATH. */
  binary?: string;
  /**
   * Extra yt-dlp flags, placed after the wrapper's own and before the URL. Only the flags in
   * `ALLOWED_FLAGS` are accepted (see `flags.ts`); anything else fails as `invalid_arguments`.
   */
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
  /**
   * An absolute path to Node, which yt-dlp then uses to solve sites' JavaScript challenges
   * (`--js-runtimes node:<path>`, with the yt-dlp-ejs scripts from its [default] extras). Unset:
   * yt-dlp's own default (Deno, if installed).
   */
  jsRuntime?: string;
}

/** The wrapper's own `--js-runtimes` arguments; throws `invalid_arguments` for a relative path. */
export function runtimeArgs(jsRuntime: string | undefined): string[] {
  if (jsRuntime === undefined) return [];
  if (!jsRuntime.startsWith("/") || /[\s,]/.test(jsRuntime)) {
    throw new YtDlpError("invalid_arguments", "jsRuntime must be an absolute path to node");
  }
  return ["--js-runtimes", `node:${jsRuntime}`];
}

export const DEFAULT_BINARY = "yt-dlp";

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
