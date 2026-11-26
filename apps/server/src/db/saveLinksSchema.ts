import type { ColumnType } from "kysely";

/**
 * `save_links`: a short-lived link that saves one file without the session cookie, for the
 * installed iPhone app's Save window (docs/downloads.md#saving-a-file). It names an entry or a
 * finished copy, never both.
 */
export interface SaveLinksTable {
  /** SHA-256 of the link's token; the token itself is never stored. */
  token_hash: Buffer;
  user_id: string;
  entry_id: string | null;
  export_id: string | null;
  expires_at: ColumnType<Date, Date | string, Date | string>;
}
