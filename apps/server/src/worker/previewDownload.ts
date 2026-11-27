import { mkdir } from "node:fs/promises";
import { download } from "@uroboros/ytdlp";
import { shiftsTimeline } from "../downloads/profiles.ts";
import {
  activeCooldown,
  clearRateLimit,
  isRateLimit,
  noteRateLimit,
  requeueDelay,
  siteOf,
} from "../downloads/rateLimits.ts";
import { mediaTitle } from "../downloads/rateLimitLog.ts";
import { RequeueError } from "../jobs/errors.ts";
import type { WorkerDeps } from "./deps.ts";
import { withLoginsOf } from "./logins.ts";

/**
 * A hover preview downloaded from the video's site (`UROBOROS_PREVIEW_METHOD=download`, the
 * default; docs/library.md "Hover previews"): a 480p copy fetched with yt-dlp, which the `preview`
 * job then copies as it is, or encodes when it isn't a preview already. Whatever the site can't
 * give, the job encodes from the stored file instead.
 */

/** The best video with the best sound, or the best single file with both… */
const FORMAT = "bv*+ba/b";
/**
 * …sorted by yt-dlp's `res` (a format's short side): the largest at most 480, else the smallest
 * above; then H.264 with AAC, which a preview can keep as they are, over other codecs.
 */
const FORMAT_SORT = "--format-sort=res:480,vcodec:h264,acodec:aac";
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** What the job knows of the media and of the stored file a preview would otherwise come from. */
export interface PreviewMedia {
  extractor: string;
  webpageUrl: string | null;
  /** The extra yt-dlp arguments of the stored file's format profile; null without a profile. */
  profileArgs: readonly string[] | null;
}

/**
 * The site page to download a preview from, or null when it is to be encoded from the stored file:
 * with `UROBOROS_PREVIEW_METHOD=transcode`, for an upload or a media with no page, and for a stored
 * file cut from the video (`shiftsTimeline`), so its preview shows what the library holds.
 */
export function previewPage(
  deps: Pick<WorkerDeps, "previewMethod">,
  media: PreviewMedia,
): string | null {
  if (deps.previewMethod !== "download") return null;
  if (media.extractor === "upload" || media.webpageUrl === null) return null;
  if (media.profileArgs !== null && shiftsTimeline(media.profileArgs)) return null;
  return media.webpageUrl;
}

/** The person who has had the video longest, whose saved site logins the download uses. */
async function earliestHolder(deps: WorkerDeps, mediaId: string): Promise<string | null> {
  const row = await deps.db
    .selectFrom("library_entries")
    .select("user_id")
    .where("media_id", "=", mediaId)
    .orderBy("added_at")
    .orderBy("id")
    .executeTakeFirst();
  return row?.user_id ?? null;
}

/**
 * Downloads the video at `page` at 480p into `workDir`: the copy's path, or null when the site gave
 * none (the video gone, private or blocked, say), and the preview is to be encoded from the stored
 * file. A site cooling down is not asked, and a rate limit starts its cooldown: the job waits
 * either out (a `RequeueError`), as a fetch does (docs/downloads.md "Rate limits").
 */
export async function downloadPreviewCopy(
  deps: WorkerDeps,
  mediaId: string,
  page: string,
  workDir: string,
  signal: AbortSignal,
): Promise<string | null> {
  const site = siteOf(page);
  const until = await activeCooldown(deps.db, site, "site");
  if (until !== null) throw new RequeueError(requeueDelay(until));
  const holder = await earliestHolder(deps, mediaId);
  const { ytdlp } = holder === null ? deps : await withLoginsOf(deps, holder);
  await mkdir(workDir, { recursive: true });
  try {
    const got = await download(page, {
      binary: ytdlp.binary,
      ...(ytdlp.env === undefined ? {} : { env: ytdlp.env }),
      ...(ytdlp.logins === undefined ? {} : { logins: ytdlp.logins }),
      ...(ytdlp.jsRuntime === undefined ? {} : { jsRuntime: ytdlp.jsRuntime }),
      workDir,
      format: FORMAT,
      extraArgs: [FORMAT_SORT, "--no-playlist"],
      signal,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
    await clearRateLimit(deps.db, site, "site");
    return got.files[0]?.path ?? null;
  } catch (err) {
    if (signal.aborted) throw err;
    if (isRateLimit(err)) {
      const next = await noteRateLimit(deps.db, site, "site", err.retryAfterMs, {
        source: "preview",
        message: err.message,
        url: page,
        title: await mediaTitle(deps.db, mediaId),
        mediaId,
      });
      deps.logger.info({ site, until: next, mediaId }, "site rate-limited a hover preview");
      throw new RequeueError(requeueDelay(next), { cause: err });
    }
    deps.logger.info(
      { err, mediaId },
      "the site gave no copy for a hover preview; making it from the stored file",
    );
    return null;
  }
}
