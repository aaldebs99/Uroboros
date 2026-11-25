import type { ColumnType, Generated } from "kysely";
import type { FileBytes } from "./schema.ts";

/** The subtitle and caption tables (docs/library.md), kept apart from schema.ts for its length. */

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;

/** `subtitles`: one subtitle file of a media. */
export interface SubtitlesTable {
  id: Generated<string>;
  media_id: string;
  lang: string;
  name: string | null;
  automatic: Defaulted<boolean>;
  storage_key: string;
  /** The file's size; null until measured (docs/library.md "Stats"). */
  size_bytes: FileBytes;
  /** When its captions were read for search; null while that waits. */
  indexed_at: Timestamp | null;
  index_failures: Defaulted<number>;
}

/** `caption_segments`: a subtitle track's captions as runs of lines, for search. */
export interface CaptionSegmentsTable {
  subtitle_id: string;
  media_id: string;
  seq: number;
  start_s: number;
  end_s: number;
  text: string;
  /** Where each line begins in `text` (UTF-16 offsets). */
  line_at: number[];
  /** When each line starts, in seconds. */
  line_start: number[];
}
