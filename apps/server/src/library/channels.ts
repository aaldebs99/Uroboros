import type { ChannelSummary } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { channelKey } from "./channelKey.ts";

const thumb = (entryId: string | null) =>
  entryId === null ? null : `/api/library/${entryId}/thumbnail`;
const dashed = (d: string | null) =>
  d === null ? null : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** The channels in the caller's library, most entries first. Videos with no channel are left out. */
export async function listChannels(
  db: Kysely<Database>,
  userId: string,
): Promise<ChannelSummary[]> {
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
    ])
    .groupBy([
      "m.extractor",
      "m.channel_id",
      sql`CASE WHEN m.channel_id IS NULL THEN coalesce(m.channel, m.uploader) END`,
    ])
    .orderBy(sql`count(*)`, "desc")
    .orderBy(sql`max(coalesce(m.channel, m.uploader, m.channel_id))`)
    .execute();
  return rows.map((r) => ({
    key: channelKey(r.extractor, r.channel_id, r.name) ?? "",
    name: r.name,
    extractor: r.extractor,
    count: Number(r.count),
    latestUpload: dashed(r.latest),
    coverThumbnailUrl: thumb(r.cover),
  }));
}
