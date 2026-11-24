import type { ColumnType, Generated } from "kysely";

/** The playback tables (docs/transcoding.md), kept apart from schema.ts for its length. */

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Created = ColumnType<Date, Date | string | undefined, never>;

/** `rendition_keyframes`: where a remux can cut (docs/transcoding.md). */
export interface RenditionKeyframesTable {
  rendition_id: string;
  times: number[];
  created_at: Created;
}

export type PlaybackState = "queued" | "starting" | "running" | "stopped" | "failed";
export type PlaybackSessionEncoder = "copy" | "libx264" | "nvenc" | "vaapi";

/** `playback_sessions`: one viewer's on-the-fly playback of an entry (docs/transcoding.md). */
export interface PlaybackSessionsTable {
  id: Generated<string>;
  rendition_id: string;
  entry_id: string;
  user_id: string | null;
  share_code: string | null;
  quality: string;
  mode: "remux" | "encode" | "audio";
  /** sessionPlan.ts's SessionPlan; written as a JSON string. */
  plan: ColumnType<unknown, string, string>;
  boundaries: number[] | null;
  state: Generated<PlaybackState>;
  encoder: PlaybackSessionEncoder | null;
  error_message: string | null;
  created_at: Created;
  stopped_at: Timestamp | null;
}
