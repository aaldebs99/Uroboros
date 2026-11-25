import { z } from "@hono/zod-openapi";

/** The most videos one playlist holds. */
export const PLAYLIST_MAX_ITEMS = 5000;

/** `manual`: made by hand in Uroboros; `youtube`: derived from a YouTube playlist, read-only. */
export const PlaylistKind = z.enum(["manual", "youtube"]).openapi("PlaylistKind");
export type PlaylistKind = z.infer<typeof PlaylistKind>;

export const PlaylistName = z.string().trim().min(1).max(100).openapi("PlaylistName");
const Description = z.string().max(5000).nullable();

export const PlaylistSummary = z
  .object({
    id: z.uuid(),
    kind: PlaylistKind,
    name: z.string(),
    /** The caller's videos in it. */
    count: z.number().int(),
    coverThumbnailUrl: z.string().nullable(),
    /** A YouTube playlist's page; null for manual ones. */
    url: z.string().nullable(),
    /** Last changed (manual) or queued (YouTube). */
    updatedAt: z.iso.datetime(),
    /**
     * The caller keeps its videos out of Library › Videos and Audio (docs/library.md "Hidden
     * playlists"); a YouTube playlist's is each person's own.
     */
    hideFromLibrary: z.boolean(),
  })
  .openapi("PlaylistSummary");
export type PlaylistSummary = z.infer<typeof PlaylistSummary>;

export const PlaylistDetail = PlaylistSummary.extend({
  description: z.string().nullable(),
}).openapi("PlaylistDetail");
export type PlaylistDetail = z.infer<typeof PlaylistDetail>;

const EntryIds = z.array(z.uuid()).max(PLAYLIST_MAX_ITEMS);

export const NewPlaylistBody = z
  .object({
    name: PlaylistName,
    description: Description.optional(),
    entryIds: EntryIds.optional(),
  })
  .openapi("NewPlaylistBody");
export type NewPlaylistBody = z.infer<typeof NewPlaylistBody>;

export const PlaylistPatch = z
  .object({ name: PlaylistName.optional(), description: Description.optional() })
  .openapi("PlaylistPatch");
export type PlaylistPatch = z.infer<typeof PlaylistPatch>;

/** `PUT /api/playlists/{id}/hidden`: whether the playlist keeps its videos out of the library. */
export const PlaylistHiddenBody = z.object({ hidden: z.boolean() }).openapi("PlaylistHiddenBody");
export type PlaylistHiddenBody = z.infer<typeof PlaylistHiddenBody>;

/** Entries of the caller's library, in order; no duplicates. */
export const PlaylistItemsBody = z.object({ entryIds: EntryIds }).openapi("PlaylistItemsBody");
export type PlaylistItemsBody = z.infer<typeof PlaylistItemsBody>;

/** Where to move one entry: 0 is first; past the end is last. */
export const PlaylistMoveBody = z
  .object({ position: z.number().int().min(0) })
  .openapi("PlaylistMoveBody");
export type PlaylistMoveBody = z.infer<typeof PlaylistMoveBody>;
