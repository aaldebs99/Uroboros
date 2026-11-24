import { YOUTUBE_SEARCH_RESULTS, type PreviewEntry, type PreviewGroup } from "@uroboros/contract";
import type { Selectable } from "kysely";
import { probe, type PlaylistEntry, type PlaylistInfo, type VideoInfo } from "@uroboros/ytdlp";
import { dispatchFor, queueDownload } from "../downloads/dispatch.ts";
import { toDownloadError } from "../downloads/errors.ts";
import { publishDownloadEvent } from "../downloads/events.ts";
import { getProfile } from "../downloads/profiles.ts";
import type { ProbeJob } from "../downloads/queues.ts";
import type { DownloadRequestsTable } from "../db/schema.ts";
import type { WorkerDeps } from "./deps.ts";
import { withLoginsOf } from "./logins.ts";
import { upsertMedia } from "./media.ts";

const PROBE_TIMEOUT_MS = 120_000;

type Deps = WorkerDeps;
type RequestRow = Selectable<DownloadRequestsTable>;

/**
 * yt-dlp's options for a flat probe with these deps (the subscription check lists with them),
 * signed in with the logins `withLoginsOf` put on them.
 */
export function ytdlpOptions(deps: Deps) {
  return {
    binary: deps.ytdlp.binary,
    ...(deps.ytdlp.env === undefined ? {} : { env: deps.ytdlp.env }),
    ...(deps.ytdlp.logins === undefined ? {} : { logins: deps.ytdlp.logins }),
    ...(deps.ytdlp.jsRuntime === undefined ? {} : { jsRuntime: deps.ytdlp.jsRuntime }),
    timeoutMs: PROBE_TIMEOUT_MS,
    flat: true,
  };
}

/**
 * A preview lists one more than it keeps, so a longer listing says it was cut: yt-dlp stops there
 * (on each of a channel's nested tabs too), instead of paging through thousands of videos.
 */
function previewArgs(deps: Deps): string[] {
  return [`--playlist-items=1:${String(deps.limits.maxPlaylistEntries + 1)}`];
}

type EntrySummary = Omit<PlaylistEntry, "children">;

function previewEntry(e: EntrySummary, fallbackExtractor: string): PreviewEntry | null {
  if (e.kind !== "video" || e.url === null) return null;
  return {
    id: e.id,
    extractor: e.extractorKey ?? fallbackExtractor,
    url: e.url,
    title: e.title,
    duration: e.duration,
    uploader: e.uploader ?? e.channel,
    thumbnailUrl: e.thumbnails.at(-1)?.url ?? null,
  };
}

function group(
  name: string,
  url: string,
  ticked: boolean,
  listed: { entries: readonly EntrySummary[]; extractorKey: string | null },
  limit: number,
): PreviewGroup {
  const entries = listed.entries
    .map((e) => previewEntry(e, listed.extractorKey ?? "generic"))
    .filter((e): e is PreviewEntry => e !== null);
  return { name, url, ticked, truncated: entries.length > limit, entries: entries.slice(0, limit) };
}

/** "Blender - Videos" → "Videos"; a tab URL's last segment otherwise. */
function tabName(e: PlaylistEntry): string {
  const fromTitle = e.title?.split(" - ").at(-1)?.trim();
  if (fromTitle !== undefined && fromTitle !== "") return fromTitle;
  const last = (e.url ?? "").replace(/\/+$/, "").split("/").at(-1) ?? "";
  return last === "streams" ? "Live" : last.charAt(0).toUpperCase() + last.slice(1);
}

const isVideosTab = (e: PlaylistEntry) =>
  /\/videos\/?$/.test(e.url ?? "") || tabName(e) === "Videos";

/**
 * A channel's main URL lists its tabs, each of which becomes a group: from the entries the root
 * listing nested under it (current yt-dlp), or else by listing the tab itself.
 */
async function tabGroups(
  deps: Deps,
  info: PlaylistInfo,
  signal?: AbortSignal,
): Promise<PreviewGroup[]> {
  const groups: PreviewGroup[] = [];
  const limit = deps.limits.maxPlaylistEntries;
  for (const tab of info.entries) {
    if (tab.kind !== "playlist" || tab.url === null) continue;
    if (tab.children !== null) {
      const listed = { entries: tab.children, extractorKey: tab.extractorKey ?? info.extractorKey };
      groups.push(group(tabName(tab), tab.url, isVideosTab(tab), listed, limit));
      continue;
    }
    try {
      const listed = await probe(tab.url, {
        ...ytdlpOptions(deps),
        extraArgs: previewArgs(deps),
        ...(signal === undefined ? {} : { signal }),
      });
      if (listed.kind === "video") continue;
      groups.push(group(tabName(tab), tab.url, isVideosTab(tab), listed, limit));
    } catch (err) {
      deps.logger.warn({ err, url: tab.url }, "probing a channel tab failed; leaving it out");
    }
  }
  return groups;
}

async function queueVideo(
  deps: Deps,
  req: { id: string; user_id: string; profile_id: string; url: string },
  info: VideoInfo,
) {
  const profile = await getProfile(deps.db, req.profile_id);
  if (profile === undefined) throw new Error("the request's profile is gone");
  const extractor = (info.extractorKey ?? "generic").toLowerCase();
  await upsertMedia(deps.db, { extractor, videoId: info.id }, info);
  const out = await deps.db.transaction().execute(async (tx) => {
    const queued = await queueDownload(tx, {
      userId: req.user_id,
      requestId: req.id,
      extractor,
      videoId: info.id,
      url: info.url ?? req.url,
      title: info.title,
      profile,
    });
    await tx
      .updateTable("download_requests")
      .set({ state: "queued", kind: "video", title: info.title })
      .where("id", "=", req.id)
      .execute();
    return queued;
  });
  if (out.downloadId !== null) {
    await publishDownloadEvent(deps.db, {
      kind: "state",
      downloadId: out.downloadId,
      userId: req.user_id,
    });
  }
  await dispatchFor(deps, req.user_id);
}

/**
 * The source a subscription or a recorded playlist names. A playlist keeps its listing's
 * extractor (as `sources` does); a channel takes its videos' extractor, so its key matches the
 * library's channel page (`youtube`, not `youtubetab`).
 */
function sourceOf(info: PlaylistInfo, channel: boolean, groups: PreviewGroup[]) {
  const listing = (info.extractorKey ?? "generic").toLowerCase();
  if (!channel) return { source_extractor: listing, source_id: info.id };
  const videos = groups
    .flatMap((g) => g.entries)
    .at(0)
    ?.extractor.toLowerCase();
  // A channel's main URL lists under its handle (`@name`); the channel id is what its tabs and
  // videos carry, so a root and a /videos subscription are the same source.
  return { source_extractor: videos ?? listing, source_id: info.channelId ?? info.id };
}

async function preview(
  deps: Deps,
  req: { id: string; url: string },
  info: PlaylistInfo,
): Promise<void> {
  const isRoot = info.entries.length > 0 && info.entries.every((e) => e.kind === "playlist");
  const groups = isRoot
    ? await tabGroups(deps, info)
    : [group(info.title ?? "Videos", req.url, true, info, deps.limits.maxPlaylistEntries)];
  const kind = isRoot ? "channel" : info.kind;
  await deps.db
    .updateTable("download_requests")
    .set({
      state: "choosing",
      kind,
      title: info.title,
      entries: JSON.stringify(groups),
      ...sourceOf(info, kind === "channel", groups),
    })
    .where("id", "=", req.id)
    .execute();
}

/**
 * A YouTube search (`POST /api/downloads/search`, its results page as the URL): the top videos as
 * one group to download from, unticked. It records no playlist: a search is not one to keep.
 */
async function searchPreview(deps: Deps, req: { id: string; url: string }): Promise<void> {
  const info = await probe(req.url, {
    ...ytdlpOptions(deps),
    extraArgs: [`--playlist-items=1:${String(YOUTUBE_SEARCH_RESULTS)}`],
  });
  const listed =
    info.kind === "video" ? { entries: [info], extractorKey: info.extractorKey } : info;
  const results = group("YouTube", req.url, false, listed, YOUTUBE_SEARCH_RESULTS);
  await deps.db
    .updateTable("download_requests")
    .set({
      state: "choosing",
      kind: "playlist",
      title: info.title,
      entries: JSON.stringify([results]),
    })
    .where("id", "=", req.id)
    .execute();
}

/** A link pasted to subscribe to that is one video: nothing to follow, and nothing downloaded. */
async function refuseVideo(deps: Deps, requestId: string): Promise<void> {
  await deps.db
    .updateTable("download_requests")
    .set({
      state: "failed",
      kind: "video",
      error_kind: "not_a_feed",
      error_message: "a single video, not a channel or playlist",
    })
    .where("id", "=", requestId)
    .execute();
}

type ProbedRequest = Pick<RequestRow, "id" | "user_id" | "profile_id" | "url" | "intent">;

/**
 * Resolves a pasted link: a video is queued (or, pasted to subscribe to, refused); a playlist or
 * channel becomes a preview, as does a search.
 */
async function resolve(deps: Deps, req: ProbedRequest): Promise<void> {
  if (req.intent === "search") {
    await searchPreview(deps, req);
    return;
  }
  // The requester's own logins, for this probe and a channel's tab probes.
  const signedIn = await withLoginsOf(deps, req.user_id);
  const info = await probe(req.url, { ...ytdlpOptions(signedIn), extraArgs: previewArgs(deps) });
  if (info.kind !== "video") await preview(signedIn, req, info);
  else if (req.intent === "subscribe") await refuseVideo(deps, req.id);
  else await queueVideo(signedIn, req, info);
}

/** The probe queue's consumer: resolves one request still probing, or records why it failed. */
export function probeProcessor(deps: Deps) {
  return async (job: { data: ProbeJob }): Promise<void> => {
    const req = await deps.db
      .selectFrom("download_requests")
      .select(["id", "user_id", "profile_id", "url", "state", "intent"])
      .where("id", "=", job.data.requestId)
      .executeTakeFirst();
    if (req?.state !== "probing") return;
    try {
      await resolve(deps, req);
    } catch (err) {
      const failure = toDownloadError(err);
      deps.logger.warn({ err, requestId: req.id }, "probe failed");
      await deps.db
        .updateTable("download_requests")
        .set({
          state: "failed",
          error_kind: failure.kind,
          error_message: failure.message,
          stderr_tail: failure.stderrTail,
        })
        .where("id", "=", req.id)
        .execute();
    }
  };
}
