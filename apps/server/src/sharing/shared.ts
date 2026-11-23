import type {
  LibraryPage,
  LibrarySort,
  PlaylistDetail,
  SharedDetail,
  SharedWithMe,
} from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { listLibraryPage, type LibraryFilters } from "../library/query.ts";
import { playlistEntryIds } from "../playlists/listing.ts";
import { copyEntries } from "../playlists/store.ts";
import { shareFor, sharesReaching, type LiveShare } from "./access.ts";
import { addManyToLibrary } from "./add.ts";
import { describeTarget } from "./targets.ts";

type Db = Kysely<Database>;

/** Everything shared with the caller and still live, newest change first (Shared › With me). */
export async function listSharedWithMe(db: Db, userId: string): Promise<SharedWithMe[]> {
  const shares = await sharesReaching(db, { userId });
  return Promise.all(
    shares.map(async (s) => {
      const facts = await describeTarget(db, s.ownerId, s.target.kind, s.target.id);
      return {
        shareId: s.id,
        kind: s.target.kind,
        id: s.target.id,
        title: facts.title,
        thumbnailUrl: facts.thumbnailUrl,
        count: facts.count,
        owner: s.ownerName,
        sharedAt: s.sharedAt.toISOString(),
        expiresAt: s.expiresAt === null ? null : s.expiresAt.toISOString(),
      };
    }),
  );
}

async function reaching(db: Db, userId: string, shareId: string): Promise<LiveShare> {
  const share = await shareFor(db, { userId }, shareId);
  if (share === undefined) throw new ApiError("not_found", "this is no longer shared with you");
  return share;
}

export async function sharedDetail(db: Db, userId: string, shareId: string): Promise<SharedDetail> {
  const s = await reaching(db, userId, shareId);
  const facts = await describeTarget(db, s.ownerId, s.target.kind, s.target.id);
  return {
    shareId: s.id,
    kind: s.target.kind,
    id: s.target.id,
    title: facts.title,
    description: facts.description,
    owner: s.ownerName,
    count: facts.count,
  };
}

/** The library filter that narrows the owner's entries to what a share holds. */
export function filterFor(target: LiveShare["target"]): LibraryFilters {
  switch (target.kind) {
    case "entry":
      return { entry: target.id };
    case "playlist":
      return { playlist: target.id };
    case "youtube":
      return { source: target.id };
  }
}

/** A page of what a share holds, in the playlist's order, with the caller's own progress. */
export async function sharedEntries(
  db: Db,
  userId: string,
  shareId: string,
  page: { cursor?: string | undefined; sort?: LibrarySort | undefined },
): Promise<LibraryPage> {
  const s = await reaching(db, userId, shareId);
  return listLibraryPage(db, userId, { ...filterFor(s.target), ...page }, { ownerId: s.ownerId });
}

/** Save as my playlist: every video of a shared playlist into the caller's library, in order. */
export async function saveShared(db: Db, userId: string, shareId: string): Promise<PlaylistDetail> {
  const s = await reaching(db, userId, shareId);
  if (s.target.kind === "entry") {
    throw new ApiError("conflict", "a shared video is kept with Add to my library");
  }
  const kind = s.target.kind === "playlist" ? "manual" : "youtube";
  const theirs = await playlistEntryIds(db, s.ownerId, { kind, id: s.target.id });
  const facts = await describeTarget(db, s.ownerId, s.target.kind, s.target.id);
  return copyEntries(db, userId, facts.title, await addManyToLibrary(db, userId, theirs));
}
