import type { PreviewEntry } from "@uroboros/contract";
import type { Transaction } from "kysely";
import type { Database } from "../db/schema.ts";

export interface PlaylistRef {
  extractor: string;
  sourceId: string;
  title: string | null;
  url: string;
}

/** One video's place in a playlist: the playlist's order is the order given. */
export interface PlaylistItemRef {
  extractor: string;
  videoId: string;
}

/**
 * Records a playlist for a person: the playlist (shared, by extractor and id), that this person has
 * it (only they see it), and each given video's position. Videos not given keep theirs, so a
 * listing cut short never drops the playlist's tail. Returns the playlist's row id.
 */
export async function recordPlaylistItems(
  tx: Transaction<Database>,
  userId: string,
  ref: PlaylistRef,
  items: readonly PlaylistItemRef[],
): Promise<string> {
  const source = await tx
    .insertInto("sources")
    .values({
      extractor: ref.extractor,
      source_id: ref.sourceId,
      kind: "playlist",
      title: ref.title,
      url: ref.url,
    })
    .onConflict((oc) =>
      oc.columns(["extractor", "source_id"]).doUpdateSet({ title: ref.title, url: ref.url }),
    )
    .returning("id")
    .executeTakeFirstOrThrow();
  await tx
    .insertInto("user_sources")
    .values({ user_id: userId, source_id: source.id })
    .onConflict((oc) => oc.columns(["user_id", "source_id"]).doNothing())
    .execute();
  const seen = new Set<string>();
  const rows = items.flatMap((item, position) => {
    const extractor = item.extractor.toLowerCase();
    const key = `${extractor}|${item.videoId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ source_id: source.id, extractor, video_id: item.videoId, position }];
  });
  if (rows.length > 0) {
    await tx
      .insertInto("source_items")
      .values(rows)
      .onConflict((oc) =>
        oc
          .columns(["source_id", "extractor", "video_id"])
          .doUpdateSet((eb) => ({ position: eb.ref("excluded.position") })),
      )
      .execute();
  }
  return source.id;
}

/** Records a playlist someone queued from a preview, with its entries in order. */
export function recordPlaylist(
  tx: Transaction<Database>,
  userId: string,
  ref: PlaylistRef,
  entries: readonly PreviewEntry[],
): Promise<string> {
  return recordPlaylistItems(
    tx,
    userId,
    ref,
    entries.map((e) => ({ extractor: e.extractor, videoId: e.id })),
  );
}
