import type { ColumnType, Generated } from "kysely";

/** The exports' table (docs/transcoding.md), kept apart from schema.ts for its length. */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export type ExportStateValue = "queued" | "running" | "done" | "failed";

/**
 * `exports`: a copy of an entry's file without the SponsorBlock segments its person skips, or a clip
 * of one range of it, to save.
 */
export interface ExportsTable {
  id: Generated<string>;
  user_id: string;
  entry_id: string;
  rendition_id: string;
  /** JSONB: the merged spans removed (`{ start, end }[]`, seconds on the file's timeline). */
  cuts: ColumnType<unknown, string, string>;
  /** The copy's container, its extension: `mp4` for a video, an audio file's own (`mp3`, `opus`…). */
  format: ColumnType<string, string | undefined, string>;
  state: ColumnType<ExportStateValue, ExportStateValue | undefined, ExportStateValue>;
  progress: number | null;
  encoder: string | null;
  storage_key: string | null;
  /** BIGINT: pg returns it as a string. */
  size_bytes: ColumnType<string | null, number | null | undefined, number | null>;
  error: string | null;
  created_at: Timestamp;
  finished_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  /** A clip's range (docs/sharing.md#clips), seconds on the file's timeline; null without one. */
  clip_start: ColumnType<number | null, number | null | undefined, number | null>;
  clip_end: ColumnType<number | null, number | null | undefined, number | null>;
}
