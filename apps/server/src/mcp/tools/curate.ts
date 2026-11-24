import {
  LibraryItem,
  McpPlaylistItemInput,
  McpPlaylistItemsInput,
  McpUpdateEntryInput,
  NewPlaylistBody,
  PlaylistDetail,
} from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema.ts";
import { ownEntry } from "../../downloads/library.ts";
import { getItem } from "../../library/item.ts";
import { setKept } from "../../library/kept.ts";
import { setWatched } from "../../library/progress.ts";
import { replaceTags } from "../../library/tags.ts";
import { getPlaylist } from "../../playlists/listing.ts";
import { appendItems, createPlaylist, removeItem } from "../../playlists/store.ts";
import { visibleEntry } from "../../sharing/access.ts";
import { defineTool, type Tool } from "../tool.ts";

interface EntryUpdate {
  entryId: string;
  tags?: string[] | undefined;
  watched?: boolean | undefined;
  kept?: boolean | undefined;
}

/**
 * What `update_entry` changes, as the REST routes would: tags and Keep on the person's own entry,
 * watched on any they may see; every check before the first write.
 */
async function updateEntry(db: Kysely<Database>, userId: string, u: EntryUpdate) {
  const entry = await visibleEntry(db, { userId }, u.entryId);
  if (u.tags !== undefined || u.kept !== undefined) await ownEntry(db, userId, u.entryId);
  if (u.tags !== undefined) await replaceTags(db, entry.id, u.tags);
  if (u.kept !== undefined) await setKept(db, userId, entry.id, u.kept);
  if (u.watched !== undefined) {
    await setWatched(db, userId, { id: entry.media_id, duration: entry.duration }, u.watched);
  }
  return getItem(db, userId, entry.id);
}

export const curateTools: Tool[] = [
  defineTool({
    name: "create_playlist",
    title: "Create a playlist",
    description:
      "Creates one of the person's playlists, optionally starting with library entries in the order given.",
    input: NewPlaylistBody,
    output: PlaylistDetail,
    write: true,
    run: (body, { db, caller }) => createPlaylist(db, caller.userId, body),
  }),
  defineTool({
    name: "add_to_playlist",
    title: "Add to a playlist",
    description: "Adds library entries to the end of one of the person's own playlists.",
    input: McpPlaylistItemsInput,
    output: PlaylistDetail,
    write: true,
    idempotent: true,
    run: async ({ playlistId, entryIds }, { db, caller }) => {
      await appendItems(db, caller.userId, playlistId, entryIds);
      return getPlaylist(db, caller.userId, playlistId);
    },
  }),
  defineTool({
    name: "remove_from_playlist",
    title: "Remove from a playlist",
    description:
      "Takes one entry out of one of the person's own playlists; the video stays in the library.",
    input: McpPlaylistItemInput,
    output: PlaylistDetail,
    write: true,
    destructive: true,
    run: async ({ playlistId, entryId }, { db, caller }) => {
      await removeItem(db, caller.userId, playlistId, entryId);
      return getPlaylist(db, caller.userId, playlistId);
    },
  }),
  defineTool({
    name: "update_entry",
    title: "Tag, mark watched or keep",
    description:
      "Changes one library entry: replaces its tags, marks it watched or not (unwatching starts it over), or keeps it from automatic clean-up. Tags and Keep need the person's own entry; watched works on one shared with them too.",
    input: McpUpdateEntryInput,
    output: LibraryItem,
    write: true,
    idempotent: true,
    run: (u, { db, caller }) => updateEntry(db, caller.userId, u),
  }),
];
