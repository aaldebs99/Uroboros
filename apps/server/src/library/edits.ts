import { sql } from "kysely";

/**
 * A person's own details of a video (docs/library.md#your-own-details) in place of the site's, over
 * the aliases `m` (the media) and `ed` (that person's `media_edits` row, left-joined: the entry
 * owner's, so whoever they share it with sees them too). A field they left alone is the site's.
 */
export const eff = {
  title: sql<string | null>`coalesce(ed.title, m.title)`,
  // A description they cleared is '' and shows none.
  description: sql<string | null>`nullif(coalesce(ed.description, m.description), '')`,
  channel: sql<string | null>`coalesce(ed.channel, m.channel)`,
  // Moved to a channel keyed by name, a video loses its site's channel id.
  channelId: sql<
    string | null
  >`CASE WHEN ed.channel IS NULL THEN m.channel_id ELSE ed.channel_id END`,
  channelExtractor: sql<string>`coalesce(ed.channel_extractor, m.extractor)`,
  /** The name a channel without an id is keyed by. */
  channelName: sql<string | null>`coalesce(ed.channel, m.channel, m.uploader)`,
  edited: sql<boolean>`(ed.user_id IS NOT NULL)`,
};

/** In a select list in place of `m.title`, `m.channel` and `m.channel_id`, plus whose channels it is in. */
export const EDITED_COLUMNS = [
  eff.title.as("title"),
  eff.channel.as("channel"),
  eff.channelId.as("channel_id"),
  eff.channelExtractor.as("channel_extractor"),
] as const;
