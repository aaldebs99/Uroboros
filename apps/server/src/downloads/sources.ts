import type { PreviewEntry } from "@uroboros/contract";
import type { Transaction } from "kysely";
import type { Database } from "../db/schema.ts";

export interface PlaylistRef {
  extractor: string;
  sourceId: string;
  title: string | null;
  url: string;
}

/**
 * Records a playlist someone queued from a preview: the playlist (shared, by extractor and id), that
 * this person queued it (only they see it), and its entries in order. Channel tabs are not recorded.
 */
export async function recordPlaylist(
  tx: Transaction<Database>,
  userId: string,
  ref: PlaylistRef,
  entries: readonly PreviewEntry[],
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
  for (const [position, e] of entries.entries()) {
    await tx
      .insertInto("source_items")
      .values({
        source_id: source.id,
        extractor: e.extractor.toLowerCase(),
        video_id: e.id,
        position,
      })
      .onConflict((oc) =>
        oc.columns(["source_id", "extractor", "video_id"]).doUpdateSet({ position }),
      )
      .execute();
  }
  return source.id;
}
