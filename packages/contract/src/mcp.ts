import { z } from "@hono/zod-openapi";
import {
  ChannelSummary,
  LIBRARY_PAGE_SIZE,
  LibraryPage,
  LibrarySort,
  SEARCH_MAX_CHARS,
  SEARCH_MIN_CHARS,
} from "./library.ts";
import { PlaylistDetail, PlaylistSummary } from "./playlists.ts";

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
