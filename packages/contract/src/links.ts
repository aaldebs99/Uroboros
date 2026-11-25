import { z } from "@hono/zod-openapi";

/**
 * A scheme at the start of a link (`https:`, `mailto:`), but not a host and port (`localhost:8080`),
 * which is a link typed without its scheme.
 */
const SCHEME = /^[a-z][a-z\d+.-]*:(?!\d+(?:[/?#]|$))/i;

/**
 * The link with `https://` in front when it was typed without a scheme (`twitch.tv/channel`), or
 * `https:` in front of a scheme-relative one (`//twitch.tv/channel`). A link with a scheme is
 * returned as it is, so `ftp:` or `javascript:` still reach the check that refuses them.
 */
export function withScheme(link: string): string {
  if (SCHEME.test(link)) return link;
  return link.startsWith("//") ? `https:${link}` : `https://${link}`;
}

/**
 * A web link someone pastes to download or subscribe to: http or https, at most 2048 characters,
 * with `https://` assumed when it has no scheme. yt-dlp follows the site's redirects from there
 * (`https://twitch.tv/channel` on to `https://www.twitch.tv/channel`).
 */
export const WebLink = z
  .string()
  .trim()
  .max(2048)
  .transform(withScheme)
  .pipe(z.url({ protocol: /^https?$/ }).max(2048));
