import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import type { JobQueue } from "../jobs/queues.ts";
import { sendNotice } from "../notices/send.ts";
import type { Message } from "../push/pusher.ts";

/** "<actor> added you to <group>", opening the group's page. */
export function addedNotice(actor: string, group: { id: string; name: string }): Message {
  return {
    title: `${actor} added you to ${group.name}`,
    path: `/settings/groups/${group.id}`,
    tag: `group-${group.id}`,
  };
}

/** Tells each person added to a group (pushed unless they turned group pushes off). */
export async function noticeAdded(
  db: Kysely<Database>,
  notify: JobQueue<NotifyJob>,
  people: readonly string[],
  message: Message,
): Promise<void> {
  for (const userId of people) {
    await sendNotice({ db, notify }, { userId, kind: "groups", message, urgency: "normal" });
  }
}
