import type { Notice, NoticeKind } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { Message } from "../push/pusher.ts";

/**
 * The notification list (docs/push.md#the-list-in-the-app): each person's notices, newest first,
 * a newer one replacing the one with its tag, dropped after a month.
 */

/** How many the list shows. */
export const NOTICE_PAGE = 50;
/** How long a notice stays. */
export const NOTICE_KEEP_DAYS = 30;

/** Files a notice; one with the same tag is replaced, comes to the top and is unread again. */
export async function fileNotice(
  db: Kysely<Database>,
  userId: string,
  kind: NoticeKind,
  message: Message,
): Promise<void> {
  const content = {
    kind,
    title: message.title === "" ? "Uroboros" : message.title,
    body: message.body === undefined || message.body === "" ? null : message.body,
    path: message.path,
  };
  await db
    .insertInto("notices")
    .values({ user_id: userId, tag: message.tag ?? null, ...content })
    .onConflict((oc) =>
      oc
        .columns(["user_id", "tag"])
        .doUpdateSet({ ...content, created_at: sql<Date>`now()`, read_at: null }),
    )
    .execute();
}

/** The newest notices and how many of all of them are unread. */
export async function listNotices(
  db: Kysely<Database>,
  userId: string,
): Promise<{ notices: Notice[]; unread: number }> {
  const [rows, counted] = await Promise.all([
    db
      .selectFrom("notices")
      .select(["id", "kind", "title", "body", "path", "created_at", "read_at"])
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(NOTICE_PAGE)
      .execute(),
    db
      .selectFrom("notices")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("user_id", "=", userId)
      .where("read_at", "is", null)
      .executeTakeFirstOrThrow(),
  ]);
  return {
    notices: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      path: r.path,
      createdAt: r.created_at.toISOString(),
      read: r.read_at !== null,
    })),
    unread: Number(counted.n),
  };
}

/**
 * Marks read the person's notices created at or before `upTo` (the newest one they saw, to the
 * millisecond an ISO time carries), so one that arrived since stays unread.
 */
export async function markNoticesRead(
  db: Kysely<Database>,
  userId: string,
  upTo: string,
): Promise<void> {
  await db
    .updateTable("notices")
    .set({ read_at: sql<Date>`now()` })
    .where("user_id", "=", userId)
    .where("read_at", "is", null)
    .where(sql<Date>`date_trunc('milliseconds', created_at)`, "<=", new Date(upTo))
    .execute();
}

/** Empties the person's list. */
export async function clearNotices(db: Kysely<Database>, userId: string): Promise<void> {
  await db.deleteFrom("notices").where("user_id", "=", userId).execute();
}

/** Drops notices older than a month; a leader duty. Returns how many went. */
export async function sweepOldNotices(db: Kysely<Database>): Promise<number> {
  const r = await db
    .deleteFrom("notices")
    .where("created_at", "<", sql<Date>`now() - make_interval(days => ${NOTICE_KEEP_DAYS})`)
    .executeTakeFirst();
  return Number(r.numDeletedRows);
}
