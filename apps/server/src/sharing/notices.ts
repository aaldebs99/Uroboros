import type { ShareKind } from "@uroboros/contract";
import type { JobQueue } from "../jobs/queues.ts";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import type { Message } from "../push/pusher.ts";
import { wantsNotice } from "../push/prefs.ts";
import { enqueueNotice } from "../subscriptions/notices.ts";

/** "<owner> shared <title> with you", opening the video, or the shared playlist's page. */
export function sharedNotice(
  owner: string,
  title: string,
  target: { kind: ShareKind; id: string; shareId: string },
): Message {
  const tag = `share-${target.shareId}`;
  if (target.kind === "entry") {
    return { title: `${owner} shared ${title} with you`, path: `/library/${target.id}`, tag };
  }
  return {
    title: `${owner} shared the playlist ${title} with you`,
    path: `/shared/${target.shareId}`,
    tag,
  };
}

/** Tells each person a share newly reaches, unless they turned shared-with-me notices off. */
export async function noticeShared(
  db: Kysely<Database>,
  notify: JobQueue<NotifyJob>,
  people: readonly string[],
  message: Message,
): Promise<void> {
  for (const userId of people) {
    if (await wantsNotice(db, userId, "shares")) {
      await enqueueNotice(notify, userId, message, "normal");
    }
  }
}
