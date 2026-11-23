import type { PreviewEntry, PreviewGroup } from "@uroboros/contract";
import { probe, type PlaylistEntry, type PlaylistInfo, type VideoInfo } from "@uroboros/ytdlp";
import { dispatchFor, queueDownload } from "../downloads/dispatch.ts";
import { toDownloadError } from "../downloads/errors.ts";
import { publishDownloadEvent } from "../downloads/events.ts";
import { getProfile } from "../downloads/profiles.ts";
import type { ProbeJob } from "../downloads/queues.ts";
import type { WorkerDeps } from "./deps.ts";
import { upsertMedia } from "./media.ts";

const PROBE_TIMEOUT_MS = 120_000;

type Deps = WorkerDeps;

function ytdlpOptions(deps: Deps) {
  return {
    binary: deps.ytdlp.binary,
    ...(deps.ytdlp.env === undefined ? {} : { env: deps.ytdlp.env }),
    ...(deps.ytdlp.cookiesFile === null ? {} : { cookiesFile: deps.ytdlp.cookiesFile }),
    ...(deps.ytdlp.jsRuntime === undefined ? {} : { jsRuntime: deps.ytdlp.jsRuntime }),
    timeoutMs: PROBE_TIMEOUT_MS,
    flat: true,
  };
}

function previewEntry(e: PlaylistEntry, fallbackExtractor: string): PreviewEntry | null {
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
  info: PlaylistInfo,
  limit: number,
): PreviewGroup {
  const entries = info.entries
    .map((e) => previewEntry(e, info.extractorKey ?? "generic"))
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

/** A channel's main URL lists its tabs; each tab is probed and becomes a group. */
async function tabGroups(
  deps: Deps,
  info: PlaylistInfo,
  signal?: AbortSignal,
): Promise<PreviewGroup[]> {
  const groups: PreviewGroup[] = [];
  for (const tab of info.entries) {
    if (tab.kind !== "playlist" || tab.url === null) continue;
    try {
      const listed = await probe(tab.url, {
        ...ytdlpOptions(deps),
        ...(signal === undefined ? {} : { signal }),
      });
      if (listed.kind === "video") continue;
      groups.push(
        group(tabName(tab), tab.url, isVideosTab(tab), listed, deps.limits.maxPlaylistEntries),
      );
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
    await publishDownloadEvent(deps.valkey, deps.prefix, {
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
  return { source_extractor: videos ?? listing, source_id: info.id };
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

/** Resolves a pasted link: a video is queued; a playlist or channel becomes a preview. */
export function probeProcessor(deps: Deps) {
  return async (job: { data: ProbeJob }): Promise<void> => {
    const req = await deps.db
      .selectFrom("download_requests")
      .select(["id", "user_id", "profile_id", "url", "state"])
      .where("id", "=", job.data.requestId)
      .executeTakeFirst();
    if (req?.state !== "probing") return;
    try {
      const info = await probe(req.url, ytdlpOptions(deps));
      if (info.kind === "video") await queueVideo(deps, req, info);
      else await preview(deps, req, info);
    } catch (err) {
      const failure = toDownloadError(err);
      deps.logger.warn({ err, requestId: req.id }, "probe failed");
      await deps.db
        .updateTable("download_requests")
        .set({ state: "failed", error_kind: failure.kind, error_message: failure.message })
        .where("id", "=", req.id)
        .execute();
    }
  };
}
