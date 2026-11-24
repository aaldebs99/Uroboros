import type { ColumnType, Generated } from "kysely";

/** The sharing tables (docs/sharing.md), kept apart from schema.ts for its length. */

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Created = ColumnType<Date, Date | string | undefined, never>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;

export type ShareMode = "people" | "link";

/** `shares`: one thing shared with people or by a public link. */
export interface SharesTable {
  id: Generated<string>;
  owner_id: string;
  entry_id: string | null;
  playlist_id: string | null;
  source_id: string | null;
  mode: ShareMode;
  code: string | null;
  allow_download: Defaulted<boolean>;
  expires_at: Timestamp | null;
  created_at: Created;
  updated_at: Defaulted<Date | string>;
}

export interface SharePeopleTable {
  share_id: string;
  user_id: string | null;
  group_name: string | null;
}

export interface NotificationPrefsTable {
  user_id: string;
  downloads: Defaulted<boolean>;
  shares: Defaulted<boolean>;
  groups: Defaulted<boolean>;
}
