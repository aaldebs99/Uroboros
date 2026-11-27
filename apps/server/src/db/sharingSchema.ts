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

/**
 * `clip_shares`: a clip shared on its own (docs/sharing.md#clips), the owner's copy of one range
 * of their entry, with people or by a public link.
 */
export interface ClipSharesTable {
  id: Generated<string>;
  owner_id: string;
  export_id: string;
  entry_id: string;
  mode: ShareMode;
  code: string | null;
  allow_download: Defaulted<boolean>;
  expires_at: Timestamp | null;
  created_at: Created;
  updated_at: Defaulted<Date | string>;
}

/** `share_people` (and `clip_share_people`): who a people-share reaches, a user or one of the owner's groups. */
export interface SharePeopleTable {
  share_id: string;
  user_id: string | null;
  group_id: string | null;
}

export interface NotificationPrefsTable {
  user_id: string;
  downloads: Defaulted<boolean>;
  shares: Defaulted<boolean>;
  groups: Defaulted<boolean>;
}
