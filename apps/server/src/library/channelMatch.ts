import { sql } from "kysely";

/**
 * The channel a library entry's video is in, as SQL over its media row `m` (docs/library.md
 * "Channels and playlists"): the extractor, the site's channel id, and the name, the channel's or
 * else the uploader's. A channel key names a channel by its id or, when the site gives none, by its
 * name (`channelKey.ts`). The channel filter and hiding both read it here, so they always agree on
 * which channel a video is in.
 */
export const channelOf = {
  extractor: sql<string>`m.extractor`,
  id: sql<string | null>`m.channel_id`,
  name: sql<string | null>`coalesce(m.channel, m.uploader)`,
};

/** A channel as a parsed key names it. */
export interface ChannelParts {
  extractor: string;
  kind: "id" | "name";
  value: string;
}

/** Whether an entry's video is in channel `c`. */
export function inChannel(c: ChannelParts) {
  return c.kind === "id"
    ? sql<boolean>`(${channelOf.extractor} = ${c.extractor} AND ${channelOf.id} = ${c.value})`
    : sql<boolean>`(${channelOf.extractor} = ${c.extractor} AND ${channelOf.id} IS NULL
        AND ${channelOf.name} = ${c.value})`;
}

/**
 * Whether the entry's owner hides the channel its video is in (`hidden_channels`,
 * docs/library.md "Hiding from the library"), by id when the site gave one and by name otherwise.
 */
export const channelHides = sql<boolean>`EXISTS (
  SELECT 1 FROM hidden_channels hc
  WHERE hc.user_id = e.user_id AND hc.extractor = ${channelOf.extractor}
    AND CASE WHEN ${channelOf.id} IS NULL
      THEN hc.kind = 'name' AND hc.value = ${channelOf.name}
      ELSE hc.kind = 'id' AND hc.value = ${channelOf.id} END)`;
