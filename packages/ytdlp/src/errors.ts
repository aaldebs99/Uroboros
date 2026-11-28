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
  "login_required",
  "login_failed",
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
  /** How long a rate-limited site said to wait, when it said (`cooldownHintMs`). */
  retryAfterMs?: number | null;
  cause?: unknown;
}

export class YtDlpError extends Error {
  override readonly name = "YtDlpError";
  readonly kind: YtDlpErrorKind;
  readonly exitCode: number | null;
  readonly stderrTail: string[];
  /** For `rate_limited`: how long the site said to wait, or null when it gave no time. */
  readonly retryAfterMs: number | null;

  constructor(kind: YtDlpErrorKind, message: string, details: YtDlpErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.kind = kind;
    this.exitCode = details.exitCode ?? null;
    this.stderrTail = details.stderrTail ?? [];
    this.retryAfterMs = details.retryAfterMs ?? null;
  }
}

/**
 * Ordered most specific first: YouTube reports a private video as "Video unavailable. This video
 * is private", so `private` must win over `unavailable`.
 */
const RULES: readonly (readonly [YtDlpErrorKind, RegExp])[] = [
  ["unsupported_url", /\bUnsupported URL\b/i],
  ["age_restricted", /confirm your age|age[- ]restricted|inappropriate for some users/i],
  // YouTube's captcha and IP block only, in yt-dlp's words for them: a limit is waited out, never
  // failed, so a site that always wants a captcha must not match.
  [
    "rate_limited",
    /HTTP Error 429|Too Many Requests|rate[- ]limit|confirm you(?:'|’)?re not a bot|temporarily blocked|requiring a captcha|IP is likely being blocked/i,
  ],
  [
    "geo_blocked",
    /not (?:made this video )?available in your (?:country|region|location)|geo[- ]?restrict|blocked it in your country/i,
  ],
  [
    "private",
    /\bprivate video\b|\bvideo is private\b|\bplaylist is private\b|members[- ]only|been granted access/i,
  ],
  // A saved login the site refused. Before `login_required`: these messages often end with yt-dlp's
  // login hint, which mentions --cookies. A bare "Unable to log in" is left alone, because
  // extractors also say that when the login page can't be reached.
  [
    "login_failed",
    /\b(?:invalid|wrong|incorrect|bad) (?:username|password|e-?mail|login|credentials)\b|\blogin failed\b/i,
  ],
  // yt-dlp's raise_login_required, once the kinds above (whose messages also suggest cookies) have
  // passed: the site wants a signed-in account (Vimeo's own pages do since 2025).
  [
    "login_required",
    /only works when logged[- ]in|\blog(?:ged)?[- ]?in (?:is )?required|registered users|account credentials|--cookies/i,
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
 * Classifies a failed run from its exit code and its stderr lines: the `ERROR:` lines first,
 * because that is where yt-dlp puts the reason, then the whole tail. Each is one text, so the
 * first rule in `RULES` that matches anywhere in it wins, whichever line it matched.
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

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
/** A hint outside these bounds is taken as the bound: no site asks for less, or means more. */
const HINT_MIN_MS = SECOND_MS;
const HINT_MAX_MS = 6 * HOUR_MS;

const AMOUNT = String.raw`(\d+(?:\.\d+)?|an?|one)`;
const UNIT = String.raw`(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b`;
/** Ways a site's message says how long to wait, tried in order; each captures an amount and a unit. */
const HINTS: readonly RegExp[] = [
  new RegExp(String.raw`\bup to ${AMOUNT}\s*${UNIT}`, "i"),
  new RegExp(
    String.raw`\b(?:try(?:ing)? again|retry|wait)\b(?:\s+(?:again|in|after|for|about|another))*\s+${AMOUNT}\s*${UNIT}`,
    "i",
  ),
];
/** An HTTP Retry-After header, should a message quote one: seconds. */
const RETRY_AFTER = /\bretry-after:?\s*(\d+)/i;
/**
 * YouTube's session limit, which yt-dlp rewords "rate-limited by YouTube for up to an hour", except
 * when a captcha comes with it: then the reason stays as YouTube gave it, and still means an hour.
 */
const YOUTUBE_SESSION_LIMIT = /This content isn(?:'|’)t available, try again later/i;

function unitMs(unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("h")) return HOUR_MS;
  if (u.startsWith("m")) return MINUTE_MS;
  return SECOND_MS;
}

function amountOf(text: string): number {
  return /^(?:an?|one)$/i.test(text) ? 1 : Number(text);
}

function hintIn(text: string): number | null {
  const header = RETRY_AFTER.exec(text);
  if (header?.[1] !== undefined) return Number(header[1]) * SECOND_MS;
  for (const pattern of HINTS) {
    const m = pattern.exec(text);
    if (m?.[1] !== undefined && m[2] !== undefined) return amountOf(m[1]) * unitMs(m[2]);
  }
  return YOUTUBE_SESSION_LIMIT.test(text) ? HOUR_MS : null;
}

/**
 * How long a rate-limiting site said to wait, from yt-dlp's stderr: YouTube's "rate-limited by
 * YouTube for up to an hour" (or its "isn't available, try again later", which means the same),
 * "try again in 30 seconds", a quoted Retry-After. yt-dlp never prints
 * the response's headers, so this is all there is; null when the message gives no time. The
 * `ERROR:` lines are read first, the last one first, then the whole tail.
 */
export function cooldownHintMs(stderr: readonly string[]): number | null {
  const errors = stderr.filter((line) => line.startsWith("ERROR:")).reverse();
  for (const text of [...errors, stderr.join("\n")]) {
    const ms = hintIn(text);
    if (ms !== null && Number.isFinite(ms)) return Math.min(HINT_MAX_MS, Math.max(HINT_MIN_MS, ms));
  }
  return null;
}
