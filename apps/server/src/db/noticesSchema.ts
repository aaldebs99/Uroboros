import type { ColumnType, Generated } from "kysely";

/** The notification list's table (docs/push.md#the-list-in-the-app), kept apart from schema.ts. */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export type NoticeKindValue = "downloads" | "shares" | "subscriptions" | "groups";

/** `notices`: one thing the server told a person, pushed or not; a newer one with its tag replaces it. */
export interface NoticesTable {
  id: Generated<string>;
  user_id: string;
  kind: NoticeKindValue;
  title: string;
  body: string | null;
  path: string;
  tag: string | null;
  created_at: Timestamp;
  read_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}
