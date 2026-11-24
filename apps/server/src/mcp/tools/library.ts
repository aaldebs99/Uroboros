import {
  LibraryItem,
  LibraryPage,
  McpChannels,
  McpEntryInput,
  McpLibraryQuery,
  McpNoInput,
  McpPlaylistInput,
  McpPlaylistPage,
  McpPlaylists,
  McpTranscriptInput,
  Transcript,
} from "@uroboros/contract";
import { listChannels } from "../../library/channels.ts";
import { getItem } from "../../library/item.ts";
import { listLibraryPage } from "../../library/query.ts";
import { readTranscript } from "../../library/transcript.ts";
import { getPlaylist, listPlaylists } from "../../playlists/listing.ts";
import { defineTool, type Tool } from "../tool.ts";

const RELATIVE =
  "Links in the result (thumbnailUrl and the like) are paths on this Uroboros server.";

export const libraryTools: Tool[] = [
  defineTool({
    name: "search_library",
    title: "Search the library",
    description: `Searches or lists the person's video library. With q, entries are ranked best match first and each carries match: where it matched (a chapter, the description or the captions), a snippet, and start, the second to play from. Without q, it lists by sort (newest added first by default), filtered by channel, playlist, YouTube playlist (source), tag or watched. Page with cursor. ${RELATIVE}`,
    input: McpLibraryQuery,
    output: LibraryPage,
    run: (args, { db, caller }) => listLibraryPage(db, caller.userId, args),
  }),
  defineTool({
    name: "get_entry",
    title: "Get a video",
    description: `One library entry with its description, chapters, subtitle tracks, tags, watch progress and file details: one of the person's own or one shared with them. ${RELATIVE}`,
    input: McpEntryInput,
    output: LibraryItem,
    run: ({ entryId }, { db, caller }) => getItem(db, caller.userId, entryId),
  }),
  defineTool({
    name: "read_transcript",
    title: "Read a transcript",
    description:
      "Reads a video's captions as lines, each with the second it starts, from the captions indexed for search: the video's own before automatic ones unless lang names a track. Lists every track; one not indexed yet has no lines. Page with fromSeconds = nextFromSeconds.",
    input: McpTranscriptInput,
    output: Transcript,
    run: ({ entryId, ...opts }, { db, caller }) => readTranscript(db, caller.userId, entryId, opts),
  }),
  defineTool({
    name: "list_channels",
    title: "List channels",
    description:
      "The channels in the person's library, with how many videos of each; a channel's key filters search_library.",
    input: McpNoInput,
    output: McpChannels,
    run: async (_args, { db, caller }) => ({ channels: await listChannels(db, caller.userId) }),
  }),
  defineTool({
    name: "list_playlists",
    title: "List playlists",
    description:
      "The person's playlists: their own (kind manual) and the YouTube playlists they queued (kind youtube).",
    input: McpNoInput,
    output: McpPlaylists,
    run: async (_args, { db, caller }) => ({ playlists: await listPlaylists(db, caller.userId) }),
  }),
  defineTool({
    name: "get_playlist",
    title: "Get a playlist",
    description: `One playlist and a page of its videos in its order. Page with cursor. ${RELATIVE}`,
    input: McpPlaylistInput,
    output: McpPlaylistPage,
    run: async ({ playlistId, cursor, limit }, { db, caller }) => {
      const playlist = await getPlaylist(db, caller.userId, playlistId);
      const within = playlist.kind === "manual" ? { playlist: playlistId } : { source: playlistId };
      const page = await listLibraryPage(db, caller.userId, { ...within, cursor, limit });
      return { playlist, page };
    },
  }),
];
