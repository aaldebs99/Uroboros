/**
 * Redaction of the secrets yt-dlp can echo into stderr before a line is kept for display: signed
 * media URLs (their query strings carry tokens and the client's IP), credentials in a URL's
 * userinfo, cookie and authorization headers, Netscape cookie-file lines, netrc lines, and the
 * saved passwords of the run itself.
 */

const REDACTED = "<redacted>";

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const HEADER_PATTERN =
  /\b(cookie|set-cookie|authorization|proxy-authorization|x-goog-visitor-id)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|.*)$/gi;
const NETSCAPE_COOKIE_LINE = /^\S+\t(?:TRUE|FALSE)\t\S*\t(?:TRUE|FALSE)\t\d+\t/;
const BEARER = /\b(bearer\s+)[\w.~+/=-]+/gi;
const NETRC_LINE = /\bmachine\s+\S+\s+login\s+\S+\s+password\s/i;
/** Shorter strings are too likely to be ordinary words to blank everywhere. */
const MIN_SECRET_CHARS = 4;

function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.replace(/\?.*$/, `?${REDACTED}`);
  }
  const userinfo = url.username !== "" || url.password !== "" ? `${REDACTED}@` : "";
  const query = url.search === "" ? "" : `?${REDACTED}`;
  return `${url.protocol}//${userinfo}${url.host}${url.pathname}${query}`;
}

/**
 * Returns `line` with every known kind of secret replaced by `<redacted>`, and each of `secrets`
 * (four characters or more) wherever it appears.
 */
export function redactLine(line: string, secrets: readonly string[] = []): string {
  if (NETSCAPE_COOKIE_LINE.test(line) || NETRC_LINE.test(line)) return REDACTED;
  const scrubbed = secrets
    .filter((secret) => secret.length >= MIN_SECRET_CHARS)
    .reduce((text, secret) => text.replaceAll(secret, REDACTED), line);
  return scrubbed
    .replace(HEADER_PATTERN, (_match, name: string, sep: string) => `${name}${sep}${REDACTED}`)
    .replace(BEARER, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(URL_PATTERN, redactUrl);
}
