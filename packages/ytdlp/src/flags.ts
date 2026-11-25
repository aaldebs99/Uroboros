import { YtDlpError } from "./errors.ts";

/**
 * The yt-dlp flags a caller may add, and nothing else. yt-dlp accepts shortened long options
 * (`--exe` for `--exec`) and bundled short ones (`-ia FILE`), and many of its options run programs
 * or reach files, so a block-list cannot be made safe. Instead each token is matched exactly
 * against this table and re-emitted in canonical form (`--name` or `--name=value`), so yt-dlp
 * only ever sees spellings the wrapper wrote.
 *
 * To allow a flag, add a row: `null` when it takes no value, otherwise a pattern its value must
 * match in full. Never add one that takes a path, a URL, a binary, or arguments for another
 * program.
 */

const INT = /^\d{1,9}$/;
const NUMBER = /^\d{1,9}(?:\.\d{1,6})?$/;
const RATE = /^\d{1,9}(?:\.\d{1,6})?[KMGkmg]?$/;
const SIZE = /^\d{1,9}(?:\.\d{1,6})?[KMGTkmgt]?$/;
const RETRIES = /^(?:\d{1,9}|infinite)$/;
const WORD = /^[a-z0-9]{1,16}$/;
const FORMATS = /^[a-z0-9]{1,16}(?:\/[a-z0-9]{1,16})*$/;
const CONVERSIONS = /^[a-z0-9]{1,16}(?:[/>][a-z0-9]{1,16})*$/;
const DATE = /^(?:\d{8}|today|yesterday|now)(?:[+-]\d{1,6}(?:day|week|month|year)s?)?$/;
/** yt-dlp's own filter and regex languages; they select and match, they never execute. */
const TEXT = /^\P{Cc}+$/u;

const FLAGS: Readonly<Record<string, RegExp | null>> = {
  // Network and pacing.
  "limit-rate": RATE,
  "throttled-rate": RATE,
  retries: RETRIES,
  "fragment-retries": RETRIES,
  "extractor-retries": RETRIES,
  "socket-timeout": NUMBER,
  "sleep-requests": NUMBER,
  "sleep-interval": NUMBER,
  "max-sleep-interval": NUMBER,
  "sleep-subtitles": NUMBER,
  "concurrent-fragments": /^(?:[1-9]|1[0-6])$/,
  // Selection.
  "playlist-items": /^[\d:,-]{1,100}$/,
  "no-playlist": null,
  "yes-playlist": null,
  "playlist-random": null,
  "lazy-playlist": null,
  date: DATE,
  datebefore: DATE,
  dateafter: DATE,
  "min-filesize": SIZE,
  "max-filesize": SIZE,
  "match-filters": TEXT,
  "break-match-filters": TEXT,
  "age-limit": INT,
  // Errors.
  "ignore-errors": null,
  "abort-on-error": null,
  "skip-unavailable-fragments": null,
  "abort-on-unavailable-fragments": null,
  // Format.
  "format-sort": /^[\w:+~.,-]{1,200}$/,
  "format-sort-force": null,
  "prefer-free-formats": null,
  "check-formats": null,
  "merge-output-format": FORMATS,
  "remux-video": CONVERSIONS,
  "recode-video": CONVERSIONS,
  // Audio.
  "extract-audio": null,
  "audio-format": WORD,
  "audio-quality": /^(?:10|\d|\d{1,4}[Kk])$/,
  "keep-video": null,
  // Subtitles and thumbnails.
  "write-subs": null,
  "write-auto-subs": null,
  "embed-subs": null,
  "write-thumbnail": null,
  "embed-thumbnail": null,
  "sub-langs": /^[\w.,*+\-!^$|()]{1,200}$/,
  // The server's own subtitle arguments skip YouTube's machine translations of a video's subtitles
  // (apps/server/src/worker/subtitles.ts); no other extractor argument.
  "extractor-args": /^youtube:skip=translated_subs$/,
  "sub-format": FORMATS,
  "convert-subs": WORD,
  "convert-thumbnails": CONVERSIONS,
  // Metadata and chapters.
  "embed-metadata": null,
  "embed-chapters": null,
  "embed-info-json": null,
  "sponsorblock-mark": /^[a-z_,-]{1,200}$/,
  "sponsorblock-remove": /^[a-z_,-]{1,200}$/,
  "remove-chapters": TEXT,
  "download-sections": TEXT,
  "force-keyframes-at-cuts": null,
  // Files.
  "restrict-filenames": null,
  "windows-filenames": null,
  "no-mtime": null,
  "no-overwrites": null,
  "force-overwrites": null,
  "trim-filenames": INT,
};

/** Exact short spellings, each a whole token: `-xk` is not `-x -k`. */
const SHORT: Readonly<Record<string, string>> = {
  "-x": "extract-audio",
  "-k": "keep-video",
  "-w": "no-overwrites",
  "-i": "ignore-errors",
  "-I": "playlist-items",
  "-N": "concurrent-fragments",
  "-r": "limit-rate",
  "-R": "retries",
  "-S": "format-sort",
};

const MAX_VALUE_LENGTH = 200;

/** A rate's bytes per second: yt-dlp reads `K`, `M` and `G` as powers of 1024. */
function bytesPerSecond(rate: string): number {
  const unit = "kmg".indexOf(rate.slice(-1).toLowerCase()) + 1;
  return Number(unit === 0 ? rate : rate.slice(0, -1)) * 1024 ** unit;
}

const atMost = (max: number) => (v: string) => Number(v) <= max;

/**
 * Bounds on the flags that pace a download, checked after their pattern: a profile could
 * otherwise crawl at a byte a second, sleep for years or retry forever, and hold its owner's
 * download slots, and the replica's, until the fetch timeout (6 hours).
 */
const BOUNDS: Readonly<Record<string, (value: string) => boolean>> = {
  "limit-rate": (v) => bytesPerSecond(v) >= 100 * 1024,
  retries: atMost(50),
  "fragment-retries": atMost(50),
  "extractor-retries": atMost(50),
  "socket-timeout": atMost(300),
  "sleep-requests": atMost(300),
  "sleep-interval": atMost(300),
  "max-sleep-interval": atMost(300),
  "sleep-subtitles": atMost(300),
};

/** Every flag name `normalizeExtraArgs` accepts, without the leading `--`. */
export const ALLOWED_FLAGS: readonly string[] = Object.keys(FLAGS);

function refuse(message: string): never {
  throw new YtDlpError("invalid_arguments", message);
}

/** The flag name a token spells, and its inline `=value` if it has one. */
function splitToken(token: string): { name: string; inline: string | undefined } {
  const short = SHORT[token];
  if (short !== undefined) return { name: short, inline: undefined };
  if (!token.startsWith("--") || token.length === 2) {
    refuse(`not an allowed flag: ${token}`);
  }
  const eq = token.indexOf("=");
  return eq === -1
    ? { name: token.slice(2), inline: undefined }
    : { name: token.slice(2, eq), inline: token.slice(eq + 1) };
}

function checkValue(name: string, pattern: RegExp, value: string): void {
  if (value.length > MAX_VALUE_LENGTH || !pattern.test(value)) {
    refuse(`invalid value for --${name}: ${value.slice(0, 50)}`);
  }
  const bound = Object.hasOwn(BOUNDS, name) ? BOUNDS[name] : undefined;
  if (bound !== undefined && !bound(value)) refuse(`out of range for --${name}: ${value}`);
}

/**
 * Checks caller-supplied yt-dlp flags against the allowlist and returns them in canonical form.
 * Accepts `--name`, `--name=value`, `--name value` and the exact short spellings; throws
 * `invalid_arguments` for anything else, including a bare `--` or a positional argument.
 */
export function normalizeExtraArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    const { name, inline } = splitToken(token);
    const pattern = Object.hasOwn(FLAGS, name) ? FLAGS[name] : undefined;
    if (pattern === undefined) refuse(`not an allowed flag: ${token}`);
    if (pattern === null) {
      if (inline !== undefined) refuse(`--${name} takes no value`);
      out.push(`--${name}`);
      continue;
    }
    let value = inline;
    if (value === undefined) {
      i++;
      value = args[i];
    }
    if (value === undefined) refuse(`--${name} needs a value`);
    checkValue(name, pattern, value);
    out.push(`--${name}=${value}`);
  }
  return out;
}
