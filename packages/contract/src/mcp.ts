import { z } from "@hono/zod-openapi";
import {
  ChannelSummary,
  LIBRARY_PAGE_SIZE,
  LibraryPage,
  LibrarySort,
  MAX_TAGS,
  SEARCH_MAX_CHARS,
  SEARCH_MIN_CHARS,
  Tag,
} from "./library.ts";
import { Download, FormatProfile, NewSearchBody } from "./downloads.ts";
import { PLAYLIST_MAX_ITEMS, PlaylistDetail, PlaylistSummary } from "./playlists.ts";

/** Where the MCP server answers (docs/mcp.md): only API tokens with the `mcp` scope reach it. */
export const MCP_PATH = "/api/mcp";

/** The most transcript lines one read returns. */
export const MAX_TRANSCRIPT_LINES = 1000;

/** One subtitle track of a video; `indexed` once its captions have been read for search. */
export const TranscriptTrack = z.object({
  lang: z.string(),
  automatic: z.boolean(),
  indexed: z.boolean(),
});
export type TranscriptTrack = z.infer<typeof TranscriptTrack>;

/** One caption line and when it starts, in seconds. */
export const TranscriptLine = z.object({ start: z.number(), text: z.string() });
export type TranscriptLine = z.infer<typeof TranscriptLine>;

/**
 * A page of a video's transcript from one track (`track` null when none matching was read), every
 * track it has, and where the next page starts (`nextFromSeconds`, null at the end).
 */
export const Transcript = z.object({
  entryId: z.uuid(),
  track: TranscriptTrack.nullable(),
  tracks: z.array(TranscriptTrack),
  lines: z.array(TranscriptLine),
  nextFromSeconds: z.number().nullable(),
});
export type Transcript = z.infer<typeof Transcript>;

/** Entries one MCP library page returns unless asked for another number. */
export const MCP_PAGE_SIZE = 20;

const PageLimit = z
  .number()
  .int()
  .min(1)
  .max(LIBRARY_PAGE_SIZE)
  .default(MCP_PAGE_SIZE)
  .describe(`Entries per page, at most ${String(LIBRARY_PAGE_SIZE)}`);
const Cursor = z.string().max(2000).describe("The nextCursor of the previous page");

/** The library's filters as MCP tool arguments (the REST route takes them as a query string). */
export const McpLibraryQuery = z.object({
  q: z
    .string()
    .max(SEARCH_MAX_CHARS)
    .optional()
    .describe(
      `Search, ${String(SEARCH_MIN_CHARS)}–${String(SEARCH_MAX_CHARS)} characters: every word (or "quoted phrase") found within one title with its channel and description, one chapter title, or one run of caption lines`,
    ),
  url: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional()
    .describe("A video's link: the entries of that video"),
  channel: z.string().max(1000).optional().describe("A channel's key (list_channels)"),
  playlist: z.uuid().optional().describe("One of the person's own playlists"),
  source: z.uuid().optional().describe("A YouTube playlist the person queued (list_playlists)"),
  tag: z.string().max(64).optional(),
  watched: z.boolean().optional(),
  sort: z.enum(LibrarySort.options).optional(),
  cursor: Cursor.optional(),
  limit: PageLimit,
});
export type McpLibraryQuery = z.infer<typeof McpLibraryQuery>;

export const McpEntryInput = z.object({ entryId: z.uuid().describe("A library entry's id") });

export const McpTranscriptInput = z.object({
  entryId: z.uuid().describe("A library entry's id"),
  lang: z.string().max(35).optional().describe("A track's language, as listed in `tracks`"),
  fromSeconds: z.number().min(0).optional().describe("Start at this moment (nextFromSeconds)"),
  maxLines: z.number().int().min(1).max(MAX_TRANSCRIPT_LINES).default(300),
});

export const McpPlaylistInput = z.object({
  playlistId: z.uuid().describe("A playlist's id (list_playlists)"),
  cursor: Cursor.optional(),
  limit: PageLimit,
});

export const McpNoInput = z.object({});

export const McpChannels = z.object({ channels: z.array(ChannelSummary) });
export const McpPlaylists = z.object({ playlists: z.array(PlaylistSummary) });
export const McpPlaylistPage = z.object({ playlist: PlaylistDetail, page: LibraryPage });

/** The longest `get_download_request` waits for a probe to finish. */
export const MAX_PROBE_WAIT_SECONDS = 15;

export const McpDownloadLinkInput = z.object({
  url: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .describe("A video, playlist or channel link yt-dlp can read"),
  profileId: z.uuid().optional().describe("A format profile (list_profiles); the default if none"),
});

export const McpSearchInput = z.object({
  query: NewSearchBody.shape.query.describe("What to search YouTube for"),
});

export const McpRequestInput = z.object({
  requestId: z.uuid().describe("A download request's id"),
  waitSeconds: z
    .number()
    .min(0)
    .max(MAX_PROBE_WAIT_SECONDS)
    .default(0)
    .describe("Wait up to this long for the link to be read (state leaves probing)"),
});

export const McpQueueInput = z.object({
  requestId: z.uuid().describe("A request in state choosing"),
  entryIds: z
    .array(z.string().min(1).max(256))
    .min(1)
    .max(1000)
    .describe("Ids of entries from the request's groups"),
});

export const McpDownloadInput = z.object({ downloadId: z.uuid().describe("A download's id") });

export const McpDownloadsInput = z.object({
  active: z.boolean().optional().describe("Only those queued or running"),
  ids: z.array(z.uuid()).max(100).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const McpDownloads = z.object({ downloads: z.array(Download) });
export const McpProfiles = z.object({ profiles: z.array(FormatProfile) });

const PlaylistId = z.uuid().describe("One of the person's own playlists (kind manual)");

export const McpPlaylistItemsInput = z.object({
  playlistId: PlaylistId,
  entryIds: z
    .array(z.uuid())
    .min(1)
    .max(PLAYLIST_MAX_ITEMS)
    .describe("Library entries to add at the end; ones already in it stay where they are"),
});

export const McpPlaylistItemInput = z.object({ playlistId: PlaylistId, entryId: z.uuid() });

/** Changes to one entry; at least one. Tags and Keep only on the person's own entries. */
export const McpUpdateEntryInput = z
  .object({
    entryId: z.uuid().describe("A library entry's id"),
    tags: z
      .array(Tag)
      .max(MAX_TAGS)
      .optional()
      .describe("The entry's tags, replacing the ones it has (lower-cased)"),
    watched: z.boolean().optional(),
    kept: z.boolean().optional().describe("Kept entries are never cleaned up automatically"),
  })
  .refine(
    (u) => u.tags !== undefined || u.watched !== undefined || u.kept !== undefined,
    "nothing to change",
  );
