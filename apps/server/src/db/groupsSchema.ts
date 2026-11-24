import type { ColumnType, Generated } from "kysely";

/** The groups' tables (docs/sharing.md "Groups"), kept apart from schema.ts for its length. */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** `groups`: a group someone made. */
export interface GroupsTable {
  id: Generated<string>;
  name: string;
  /** Null once its maker's account is gone. */
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** `group_members`: who is in a group, and whether they run it. */
export interface GroupMembersTable {
  group_id: string;
  user_id: string;
  manager: ColumnType<boolean, boolean | undefined, boolean>;
  added_at: Timestamp;
}
