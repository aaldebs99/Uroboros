/**
 * The name of the site a video comes from, shown where its channel would be when the site names
 * neither a channel nor an uploader (docs/library.md). `extractor` is the media row's lowercased
 * yt-dlp extractor key ("youtube", "vimeo", "twitchvod", "generic").
 */

/** Well-known sites by extractor-key prefix, so a site's variants share its name (twitchvod). */
const NAMES: readonly (readonly [string, string])[] = [
  ["youtube", "YouTube"],
  ["vimeo", "Vimeo"],
  ["twitch", "Twitch"],
  ["soundcloud", "SoundCloud"],
  ["dailymotion", "Dailymotion"],
  ["bilibili", "Bilibili"],
  ["tiktok", "TikTok"],
  ["twitter", "X"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["reddit", "Reddit"],
  ["rumble", "Rumble"],
  ["odysee", "Odysee"],
  ["lbry", "Odysee"],
  ["peertube", "PeerTube"],
  ["bandcamp", "Bandcamp"],
  ["mixcloud", "Mixcloud"],
  ["archiveorg", "Internet Archive"],
  ["niconico", "Niconico"],
  ["kick", "Kick"],
  ["streamable", "Streamable"],
  ["bluesky", "Bluesky"],
  ["patreon", "Patreon"],
  ["nebula", "Nebula"],
  ["bbc", "BBC"],
];

/** The page's host without a leading "www.", or null when there is no usable URL. */
function hostOf(pageUrl: string | null): string | null {
  if (pageUrl === null) return null;
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, "");
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

/**
 * A well-known site's own name ("YouTube", "Vimeo"); otherwise the page's host ("example.com",
 * which is also what a direct link through yt-dlp's generic extractor gets); otherwise the
 * extractor key, capitalized.
 */
export function platformName(extractor: string, pageUrl: string | null): string {
  const key = extractor.toLowerCase();
  const known = key === "generic" ? undefined : NAMES.find(([prefix]) => key.startsWith(prefix));
  if (known !== undefined) return known[1];
  const host = hostOf(pageUrl);
  if (host !== null) return host;
  return key === "" ? "Unknown site" : key.charAt(0).toUpperCase() + key.slice(1);
}
