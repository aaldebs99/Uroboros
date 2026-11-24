/**
 * What a pasted link can match in the library (`GET /api/library?url=`): a YouTube video by its
 * id, whichever of YouTube's link shapes it came in, or else the page URLs it may be stored as.
 */
export type LinkMatch = { kind: "youtube"; videoId: string } | { kind: "pages"; urls: string[] };

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const VIDEO_ID = /^[\w-]{11}$/;
const PATH_ID = /^\/(?:shorts|live|embed|v)\/([\w-]{11})(?:\/|$)/;

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) {
    const id = url.pathname.split("/")[1] ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (url.pathname === "/watch") {
    const v = url.searchParams.get("v") ?? "";
    return VIDEO_ID.test(v) ? v : null;
  }
  return PATH_ID.exec(url.pathname)?.[1] ?? null;
}

const otherSlash = (path: string) =>
  path.endsWith("/") ? (path.length > 1 ? path.slice(0, -1) : path) : `${path}/`;

/** The page as pasted, then unfragmented in either scheme, with or without `www.` and a final slash. */
function pageCandidates(raw: string, url: URL): string[] {
  const out = new Set([raw]);
  const bare = url.hostname.replace(/^www\./, "");
  for (const protocol of ["https:", "http:"]) {
    for (const host of [bare, `www.${bare}`]) {
      for (const path of [url.pathname, otherSlash(url.pathname)]) {
        const u = new URL(url.href);
        u.hash = "";
        u.protocol = protocol;
        u.hostname = host;
        u.pathname = path;
        out.add(u.href);
      }
    }
  }
  return [...out];
}

export function linkMatch(raw: string): LinkMatch {
  if (!URL.canParse(raw)) return { kind: "pages", urls: [raw] };
  const url = new URL(raw);
  const videoId = youtubeId(url);
  return videoId === null
    ? { kind: "pages", urls: pageCandidates(raw, url) }
    : { kind: "youtube", videoId };
}
