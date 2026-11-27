import type { ColumnType } from "kysely";

/**
 * `media_edits`: a person's own details of a video they hold (docs/library.md#your-own-details),
 * shown in place of the site's to them and to whoever they share it with. A null field is the
 * site's; a description of '' is one they cleared. The channel is the one they moved the video to:
 * its name, the extractor whose channels it joins, and that channel's id when it is keyed by one.
 */
export interface MediaEditsTable {
  user_id: string;
  media_id: string;
  title: string | null;
  description: string | null;
  channel: string | null;
  channel_extractor: string | null;
  channel_id: string | null;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}
