import { sql } from "kysely";
import { eff } from "./edits.ts";

/**
 * The channel a library entry's video shows in for the entry's owner (docs/library.md "Channels
 * and playlists"): its site's, or the one they moved it to (docs/library.md#your-own-details), so
 * SQL over the media row `m` and the owner's `media_edits` row `ed`, which a query reading it must
 * left-join. A channel key names a channel by its extractor and id or, when there is none, by its
 * name (`channelKey.ts`). The channel filter and hiding both read it here, so they always agree on
 * which channel a video is in.
 */
export const channelOf = {
  extractor: eff.channelExtractor,
  id: eff.channelId,
  name: eff.channelName,
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
