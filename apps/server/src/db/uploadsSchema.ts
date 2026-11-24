import type { ColumnType, Generated } from "kysely";

/** The uploads' tables (docs/uploads.md), kept apart from schema.ts for its length. */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export type UploadStateValue = "receiving" | "processing" | "done" | "failed";

/** `uploads`: a video a person is sending, or sent, from their browser. */
export interface UploadsTable {
  id: Generated<string>;
  /** Null once the person's account is gone. */
  user_id: string | null;
  /** The media row the job makes, under this id. */
  media_id: Generated<string>;
  filename: string;
  /** BIGINT; pg returns it as a string. */
  size_bytes: ColumnType<string, number, number>;
  /** Every part but the last is this many bytes. */
  part_bytes: number;
  ext: string;
  title: string;
  description: string | null;
  creator: string;
  tags: Generated<string[]>;
  storage_key: string;
  store_upload_id: string;
  thumbnail_key: string | null;
  state: ColumnType<UploadStateValue, UploadStateValue | undefined, UploadStateValue>;
  error: string | null;
  entry_id: string | null;
  created_at: Timestamp;
  touched_at: Timestamp;
}

/** `upload_parts`: the parts of an upload the store holds. */
export interface UploadPartsTable {
  upload_id: string;
  n: number;
  size_bytes: number;
  etag: string;
  checksum: string | null;
}
