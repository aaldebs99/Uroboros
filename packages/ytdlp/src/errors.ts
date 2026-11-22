/**
 * Every way a yt-dlp or ffprobe run can fail, as one error class with a closed `kind`, so a caller
 * can branch exhaustively (retry on `rate_limited` and `network`, surface `private` to the user,
 * and so on).
 */

export const YTDLP_ERROR_KINDS = [
  // Classified from yt-dlp's stderr.
  "unavailable",
  "private",
  "geo_blocked",
  "age_restricted",
  "rate_limited",
  "network",
  "unsupported_url",
  "unknown",
  // Raised by the wrapper itself.
  "invalid_url",
  "invalid_arguments",
  "cancelled",
  "timed_out",
  "spawn_failed",
  "invalid_output",
] as const;

export type YtDlpErrorKind = (typeof YTDLP_ERROR_KINDS)[number];

export interface YtDlpErrorDetails {
  /** The process's exit code, or null when it did not exit normally (or never started). */
  exitCode?: number | null;
  /** The last lines of stderr, already redacted, for display. */
  stderrTail?: string[];
  cause?: unknown;
}

export class YtDlpError extends Error {
  override readonly name = "YtDlpError";
  readonly kind: YtDlpErrorKind;
  readonly exitCode: number | null;
  readonly stderrTail: string[];

  constructor(kind: YtDlpErrorKind, message: string, details: YtDlpErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.kind = kind;
    this.exitCode = details.exitCode ?? null;
    this.stderrTail = details.stderrTail ?? [];
  }
}

/**
 * Ordered most specific first: YouTube reports a private video as "Video unavailable. This video
 * is private", so `private` must win over `unavailable`.
 */
const RULES: readonly (readonly [YtDlpErrorKind, RegExp])[] = [
  ["unsupported_url", /\bUnsupported URL\b/i],
  ["age_restricted", /confirm your age|age[- ]restricted|inappropriate for some users/i],
  [
    "rate_limited",
    /HTTP Error 429|Too Many Requests|rate[- ]limit|confirm you(?:'|’)?re not a bot|temporarily blocked/i,
  ],
  [
    "geo_blocked",
    /not (?:made this video )?available in your (?:country|region|location)|geo[- ]?restrict|blocked it in your country/i,
  ],
  [
    "private",
    /\bprivate video\b|\bvideo is private\b|\bplaylist is private\b|members[- ]only|been granted access/i,
  ],
  // Before `unavailable`, so "HTTP Error 503: Service Unavailable" is a network failure.
  ["network", /HTTP Error 5\d\d/i],
  [
    "unavailable",
    /\bunavailable\b|has been removed|does not exist|HTTP Error 404|been terminated|no longer available|not available|Premieres in/i,
  ],
  [
    "network",
    /Unable to download (?:webpage|API page|JSON)|urlopen error|Connection (?:refused|reset|aborted)|timed out|Temporary failure in name resolution|Name or service not known|Network is unreachable|No route to host|IncompleteRead|SSL: |TransportError/i,
  ],
];

/** yt-dlp exits 2 when its own argument parser rejects the command line. */
const USAGE_EXIT_CODE = 2;

/**
 * Classifies a failed run from its exit code and its stderr lines. The `ERROR:` lines are tried
 * first, last one first, because that is where yt-dlp puts the reason; then the whole tail.
 */
export function classifyFailure(
  exitCode: number | null,
  stderr: readonly string[],
): YtDlpErrorKind {
  if (exitCode === USAGE_EXIT_CODE && stderr.some((line) => /\berror: /.test(line))) {
    return "invalid_arguments";
  }
  const errors = stderr.filter((line) => line.startsWith("ERROR:")).reverse();
  for (const text of [errors.join("\n"), stderr.join("\n")]) {
    const kind = RULES.find(([, pattern]) => pattern.test(text))?.[0];
    if (kind !== undefined) return kind;
  }
  return "unknown";
}

/** The message for a classified failure: yt-dlp's last ERROR line, or a generic one. */
export function failureMessage(exitCode: number | null, stderr: readonly string[]): string {
  const last = stderr.findLast((line) => line.startsWith("ERROR:"));
  if (last !== undefined) return last.replace(/^ERROR:\s*/, "");
  return `exited with ${exitCode === null ? "a signal" : `code ${String(exitCode)}`}`;
}
