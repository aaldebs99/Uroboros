import type { ChannelSummary } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { channelKey } from "./channelKey.ts";
import { eff } from "./edits.ts";
import { hiddenChannelKeys } from "./hiddenChannels.ts";
import { thumbnailUrl } from "./thumbnailUrl.ts";
const dashed = (d: string | null) =>
  d === null ? null : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/**
 * The channels in the caller's library, most entries first, each video in the one it shows in: its
 * site's, or the one the caller moved it to (docs/library.md#your-own-details). Each says whether
 * the caller hides it (docs/library.md "Hiding from the library"). Videos with no channel are left
 * out.
 */
export async function listChannels(
  db: Kysely<Database>,
  userId: string,
): Promise<ChannelSummary[]> {
  const hidden = await hiddenChannelKeys(db, userId);
  const name = sql<string>`max(coalesce(${eff.channel}, m.uploader, ${eff.channelId}))`;
  const rows = await db
    .selectFrom("library_entries as e")
    .innerJoin("media as m", "m.id", "e.media_id")
    .leftJoin("media_edits as ed", (j) =>
      j.onRef("ed.media_id", "=", "e.media_id").onRef("ed.user_id", "=", "e.user_id"),
    )
    .where("e.user_id", "=", userId)
    .where(sql<boolean>`(${eff.channelId} IS NOT NULL OR ${eff.channelName} IS NOT NULL)`)
    .select([
      eff.channelExtractor.as("extractor"),
      eff.channelId.as("channel_id"),
      name.as("name"),
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
      eff.channelExtractor,
      eff.channelId,
      sql`CASE WHEN ${eff.channelId} IS NULL THEN ${eff.channelName} END`,
    ])
    .orderBy(sql`count(*)`, "desc")
    .orderBy(name)
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
