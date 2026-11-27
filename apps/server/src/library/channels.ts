import type { ChannelSummary } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { channelKey } from "./channelKey.ts";
import { hiddenChannelKeys } from "./hiddenChannels.ts";
import { thumbnailUrl } from "./thumbnailUrl.ts";
const dashed = (d: string | null) =>
  d === null ? null : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/**
 * The channels in the caller's library, most entries first, each saying whether the caller hides it
 * (docs/library.md "Hiding from the library"). Videos with no channel are left out.
 */
export async function listChannels(
  db: Kysely<Database>,
  userId: string,
): Promise<ChannelSummary[]> {
  const hidden = await hiddenChannelKeys(db, userId);
  const rows = await db
    .selectFrom("library_entries as e")
    .innerJoin("media as m", "m.id", "e.media_id")
    .where("e.user_id", "=", userId)
    .where(sql<boolean>`(m.channel_id IS NOT NULL OR coalesce(m.channel, m.uploader) IS NOT NULL)`)
    .select([
      "m.extractor",
      "m.channel_id",
      sql<string>`max(coalesce(m.channel, m.uploader, m.channel_id))`.as("name"),
      sql<string>`count(*)`.as("count"),
      sql<string | null>`max(m.upload_date)`.as("latest"),
      sql<
        string | null
      >`(array_agg(e.id ORDER BY e.added_at DESC) FILTER (WHERE m.thumbnail_key IS NOT NULL))[1]`.as(
        "cover",
      ),
      sql<
        string | null
      >`(array_agg(m.thumbnail_key ORDER BY e.added_at DESC) FILTER (WHERE m.thumbnail_key IS NOT NULL))[1]`.as(
        "cover_key",
      ),
    ])
    .groupBy([
      "m.extractor",
      "m.channel_id",
      sql`CASE WHEN m.channel_id IS NULL THEN coalesce(m.channel, m.uploader) END`,
    ])
    .orderBy(sql`count(*)`, "desc")
    .orderBy(sql`max(coalesce(m.channel, m.uploader, m.channel_id))`)
    .execute();
  return rows.map((r) => {
    const key = channelKey(r.extractor, r.channel_id, r.name) ?? "";
    return {
      key,
      name: r.name,
      extractor: r.extractor,
      count: Number(r.count),
      latestUpload: dashed(r.latest),
      coverThumbnailUrl:
        r.cover === null ? null : thumbnailUrl(`/api/library/${r.cover}/thumbnail`, r.cover_key),
      hideFromLibrary: hidden.has(key),
    };
  });
}
