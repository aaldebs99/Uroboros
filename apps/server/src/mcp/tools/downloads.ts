import {
  Download,
  DownloadRequest,
  McpDownloadInput,
  McpDownloadLinkInput,
  McpDownloads,
  McpDownloadsInput,
  McpNoInput,
  McpProfiles,
  McpQueueInput,
  McpRequestInput,
  McpSearchInput,
  QueueSelectionResult,
} from "@uroboros/contract";
import { setTimeout as sleep } from "node:timers/promises";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema.ts";
import { ApiError } from "../../api/errors.ts";
import type { Principal } from "../../auth/guard.ts";
import {
  cancelDownload,
  confirmDownload,
  retryDownload,
  type DownloadContext,
} from "../../downloads/dispatch.ts";
import { defaultProfileFor, profilesFor, toProfile } from "../../downloads/profiles.ts";
import {
  createRequest,
  findRequest,
  queueSelection,
  toRequest,
  youtubeSearchUrl,
} from "../../downloads/requests.ts";
import { need } from "../../downloads/routes.ts";
import { downloadRows, toDownloads } from "../../downloads/serialize.ts";
import type { McpCaller } from "../caller.ts";
import { defineTool, type Tool } from "../tool.ts";

const PROBE_POLL_MS = 500;

/** The caller as the download services take it: always a member, never with an admin's reach. */
export const asMember = (caller: McpCaller): Principal => ({
  userId: caller.userId,
  role: "member",
  via: "token",
});

async function ownDownload(ctx: DownloadContext, userId: string, id: string): Promise<Download> {
  const [download] = await toDownloads(ctx, await downloadRows(ctx.db, { userId, ids: [id] }));
  if (download === undefined) throw new ApiError("not_found", "no such download");
  return download;
}

/** The request, once its link is read or `seconds` pass (or the call is cancelled). */
async function settledRequest(
  db: Kysely<Database>,
  caller: McpCaller,
  id: string,
  seconds: number,
  signal: AbortSignal,
) {
  const deadline = Date.now() + seconds * 1000;
  let row = await findRequest(db, asMember(caller), id);
  while (row.state === "probing" && Date.now() < deadline) {
    try {
      await sleep(Math.min(PROBE_POLL_MS, deadline - Date.now()), undefined, { signal });
    } catch {
      break;
    }
    row = await findRequest(db, asMember(caller), id);
  }
  return row;
}

const PREVIEW =
  "It returns a download request in state probing while a worker reads the link; get_download_request (with waitSeconds) says when it is done.";

export const downloadTools: Tool[] = [
  defineTool({
    name: "list_downloads",
    title: "List downloads",
    description:
      "The person's downloads, queued and running first, then newest: state, progress, title and any error.",
    input: McpDownloadsInput,
    output: McpDownloads,
    run: async ({ active, ids, limit }, { downloads, caller }) => {
      const ctx = need(downloads);
      const rows = await downloadRows(ctx.db, {
        userId: caller.userId,
        limit,
        ...(active === undefined ? {} : { active }),
        ...(ids === undefined ? {} : { ids }),
      });
      return { downloads: await toDownloads(ctx, rows) };
    },
  }),
  defineTool({
    name: "get_download_request",
    title: "Get a download request",
    description:
      "A pasted link or YouTube search: probing while a worker reads it; then queued (a single video, now downloading), choosing (a playlist, channel or search whose groups list the videos to pick with queue_selection; it waits a day from when it is ready, then is deleted) or failed (with errorKind and errorMessage). waitSeconds waits for it to leave probing.",
    input: McpRequestInput,
    output: DownloadRequest,
    run: async ({ requestId, waitSeconds }, { downloads, caller }, signal) =>
      toRequest(await settledRequest(need(downloads).db, caller, requestId, waitSeconds, signal)),
  }),
  defineTool({
    name: "list_profiles",
    title: "List format profiles",
    description:
      "The format profiles the person may download with (quality, audio only and the like); isDefault marks the one used when none is given.",
    input: McpNoInput,
    output: McpProfiles,
    run: async (_args, { db, caller }) => {
      const [rows, fallback] = await Promise.all([
        profilesFor(db, caller.userId),
        defaultProfileFor(db, caller.userId),
      ]);
      return { profiles: rows.map((row) => toProfile(row, fallback?.id ?? null)) };
    },
  }),
  defineTool({
    name: "download_link",
    title: "Download a link",
    description: `Saves a video to the person's library from a link (YouTube or any site yt-dlp reads). A playlist or channel link is previewed instead, for queue_selection to pick from. ${PREVIEW}`,
    input: McpDownloadLinkInput,
    output: DownloadRequest,
    write: true,
    openWorld: true,
    run: (args, { downloads, caller }) =>
      createRequest(need(downloads), caller.userId, { ...args, intent: "download" }),
  }),
  defineTool({
    name: "search_youtube",
    title: "Search YouTube",
    description: `Searches YouTube for videos to save: the request's groups list the top results, any of which queue_selection saves. ${PREVIEW}`,
    input: McpSearchInput,
    output: DownloadRequest,
    write: true,
    openWorld: true,
    run: ({ query }, { downloads, caller }) =>
      createRequest(need(downloads), caller.userId, {
        url: youtubeSearchUrl(query),
        intent: "search",
      }),
  }),
  defineTool({
    name: "queue_selection",
    title: "Save picked videos",
    description:
      "Downloads the picked entries of a request in state choosing (a playlist, channel or search). Videos already in the library or already downloading are skipped.",
    input: McpQueueInput,
    output: QueueSelectionResult,
    write: true,
    openWorld: true,
    run: ({ requestId, entryIds }, { downloads, caller }) =>
      queueSelection(need(downloads), asMember(caller), requestId, entryIds),
  }),
  defineTool({
    name: "cancel_download",
    title: "Cancel a download",
    description: "Cancels one of the person's queued or running downloads.",
    input: McpDownloadInput,
    output: Download,
    write: true,
    destructive: true,
    run: async ({ downloadId }, { downloads, caller }) => {
      const ctx = need(downloads);
      await cancelDownload(ctx, asMember(caller), downloadId);
      return ownDownload(ctx, caller.userId, downloadId);
    },
  }),
  defineTool({
    name: "retry_download",
    title: "Retry a download",
    description: "Queues one of the person's failed or cancelled downloads again.",
    input: McpDownloadInput,
    output: Download,
    write: true,
    openWorld: true,
    run: async ({ downloadId }, { downloads, caller }) => {
      const ctx = need(downloads);
      await retryDownload(ctx, asMember(caller), downloadId);
      return ownDownload(ctx, caller.userId, downloadId);
    },
  }),
  defineTool({
    name: "confirm_download",
    title: "Confirm a large download",
    description:
      "Lets one of the person's downloads that waits for their OK (its sizeHold says yt-dlp expects it to be larger than the server's limit) go ahead and be fetched.",
    input: McpDownloadInput,
    output: Download,
    write: true,
    openWorld: true,
    run: async ({ downloadId }, { downloads, caller }) => {
      const ctx = need(downloads);
      await confirmDownload(ctx, asMember(caller), downloadId);
      return ownDownload(ctx, caller.userId, downloadId);
    },
  }),
];
