import { createHash } from "node:crypto";

/** yt-dlp's extractor for a page or file it has no extractor of its own for. */
const GENERIC = "generic";

/**
 * The video id a media row is keyed by (with its extractor). A site's own extractor reports the
 * site's id, which only that site hands out. The generic extractor reports the file or page name
 * (`…/meeting.mp4` is `meeting`), which anyone can give a file of their own, so two people's
 * links would meet on one media row and share each other's files. Its id carries a hash of the
 * link (without its fragment) as well: the same link is still the same video.
 */
export function mediaVideoId(extractor: string, id: string, url: string): string {
  if (extractor.toLowerCase() !== GENERIC) return id;
  const link = url.split("#", 1)[0] ?? url;
  return `${id}~${createHash("sha256").update(link).digest("hex").slice(0, 16)}`;
}
