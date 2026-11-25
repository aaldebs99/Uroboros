import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";

/**
 * A YouTube playlist (`sources`) holding `videoIds` in that order, which `userIds` have queued
 * (`user_sources`). Returns its id.
 */
export async function seedYouTubePlaylist(
  db: Kysely<Database>,
  userIds: string[],
  videoIds: string[],
  title = "From YouTube",
): Promise<string> {
  const source = await db
    .insertInto("sources")
    .values({
      extractor: "youtube",
      source_id: `PL${String(Math.random()).slice(2)}`,
      kind: "playlist",
      title,
      url: "https://www.youtube.com/playlist?list=PLx",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const user_id of userIds) {
    await db.insertInto("user_sources").values({ user_id, source_id: source.id }).execute();
  }
  for (const [position, video_id] of videoIds.entries()) {
    await db
      .insertInto("source_items")
      .values({ source_id: source.id, extractor: "youtube", video_id, position })
      .execute();
  }
  return source.id;
}
