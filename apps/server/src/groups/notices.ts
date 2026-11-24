import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import type { JobQueue } from "../jobs/queues.ts";
import type { Message } from "../push/pusher.ts";
import { wantsNotice } from "../push/prefs.ts";
import { enqueueNotice } from "../subscriptions/notices.ts";

/** "<actor> added you to <group>", opening the group's page. */
export function addedNotice(actor: string, group: { id: string; name: string }): Message {
  return {
    title: `${actor} added you to ${group.name}`,
    path: `/shared/groups/${group.id}`,
    tag: `group-${group.id}`,
  };
}

/** Tells each person added to a group, unless they turned group notices off. */
export async function noticeAdded(
  db: Kysely<Database>,
  notify: JobQueue<NotifyJob>,
  people: readonly string[],
  message: Message,
): Promise<void> {
  for (const userId of people) {
    if (await wantsNotice(db, userId, "groups")) {
      await enqueueNotice(notify, userId, message, "normal");
    }
  }
}
