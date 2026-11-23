import type { NotificationPrefs } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/** A person's choices; no row means every kind is on. */
export async function getPrefs(db: Kysely<Database>, userId: string): Promise<NotificationPrefs> {
  const row = await db
    .selectFrom("notification_prefs")
    .select(["downloads", "shares"])
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row ?? { downloads: true, shares: true };
}

export async function setPrefs(
  db: Kysely<Database>,
  userId: string,
  prefs: NotificationPrefs,
): Promise<NotificationPrefs> {
  await db
    .insertInto("notification_prefs")
    .values({ user_id: userId, ...prefs })
    .onConflict((oc) => oc.column("user_id").doUpdateSet(prefs))
    .execute();
  return prefs;
}

/** Whether this person wants this kind of notification. */
export async function wantsNotice(
  db: Kysely<Database>,
  userId: string,
  kind: keyof NotificationPrefs,
): Promise<boolean> {
  return (await getPrefs(db, userId))[kind];
}
