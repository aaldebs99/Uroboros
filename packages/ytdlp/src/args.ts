import { YtDlpError } from "./errors.ts";
import { POSTPROCESSOR_FORMATS } from "./mediaFormats.ts";

/** A saved login for one yt-dlp site, keyed by the extractor's netrc machine name. */
export interface SiteLoginSecret {
  site: string;
  username: string;
  password: string;
}

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
  /**
   * Saved site logins. The wrapper writes them to a private `.netrc` for the run (removed
   * afterwards) and passes `--netrc --netrc-location`, so each extractor finds its own site's
   * login and no password is on the command line; every password is scrubbed from the kept
   * stderr lines too.
   */
  logins?: readonly SiteLoginSecret[];
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

/** The private files a run reads its secrets from (see `runFiles.ts`), null when unused. */
export interface RunFiles {
  /** The run's copy of the cookies file. */
  cookies: string | null;
  /** The directory holding the run's `.netrc`. */
  netrcDir: string | null;
}

/** yt-dlp's post-processors that run ffmpeg on what it downloaded (their `pp_key` names). */
const FFMPEG_POSTPROCESSORS = [
  "CopyStream",
  "EmbedSubtitle",
  "EmbedThumbnail",
  "ExtractAudio",
  "FixupDuplicateMoov",
  "FixupDuration",
  "FixupM3u8",
  "FixupM4a",
  "FixupStretched",
  "FixupTimestamp",
  "Merger",
  "Metadata",
  "SplitChapters",
  "SponsorBlock",
  "SubtitlesConvertor",
  "ThumbnailsConvertor",
  "VideoConvertor",
  "VideoRemuxer",
];
/** The two that cut or join through a concat list yt-dlp writes (`-f concat -safe 0`). */
const CONCAT_POSTPROCESSORS = ["Concat", "ModifyChapters"];

/**
 * Every input of every ffmpeg post-processor held to what it may be read as (`mediaFormats.ts`
 * says why) and to local files. yt-dlp takes `<PP>+ffmpeg_i` only per post-processor: a bare
 * `ffmpeg_i` reaches none of them. Its own ffprobe calls take no arguments at all.
 */
const postprocessorArgs = (): string[] =>
  [
    ...FFMPEG_POSTPROCESSORS.map((pp) => [pp, POSTPROCESSOR_FORMATS] as const),
    ...CONCAT_POSTPROCESSORS.map((pp) => [pp, `concat,${POSTPROCESSOR_FORMATS}`] as const),
  ].flatMap(([pp, formats]) => [
    "--postprocessor-args",
    `${pp}+ffmpeg_i:-format_whitelist ${formats} -protocol_whitelist file`,
  ]);

/**
 * The arguments every run starts with: no user config, no update check, no colour codes, and the
 * post-processors' inputs pinned.
 */
export function baseArgs(files: RunFiles): string[] {
  const args = ["--ignore-config", "--no-update", "--color", "never", ...postprocessorArgs()];
  if (files.cookies !== null) args.push("--cookies", files.cookies);
  if (files.netrcDir !== null) args.push("--netrc", "--netrc-location", files.netrcDir);
  return args;
}

/** Assembles a full command line, the URL last and behind `--` so it is never an option. */
export function commandLine(
  files: RunFiles,
  own: readonly string[],
  extra: readonly string[],
  url: string,
): string[] {
  return [...baseArgs(files), ...own, ...extra, "--", url];
}
