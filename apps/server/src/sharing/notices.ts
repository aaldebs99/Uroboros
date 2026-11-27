import type { ClipRange, ShareKind } from "@uroboros/contract";
import type { JobQueue } from "../jobs/queues.ts";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import { clipLabel } from "../exports/clip.ts";
import { sendNotice } from "../notices/send.ts";
import type { Message } from "../push/pusher.ts";

/**
 * "<owner> shared <title> with you", opening the video, or the shared playlist's page. A video
 * shared opened at a `clip` (docs/sharing.md#clips) says "a clip of" and its range, and opens there;
 * under the share's tag, it replaces an earlier notice of the share rather than piling up.
 */
export function sharedNotice(
  owner: string,
  title: string,
  target: { kind: ShareKind; id: string; shareId: string },
  clip?: ClipRange,
): Message {
  const tag = `share-${target.shareId}`;
  if (target.kind === "entry" && clip !== undefined) {
    return {
      title: `${owner} shared a clip of ${title} with you`,
      body: clipLabel(clip),
      path: `/library/${target.id}?t=${String(clip.start)}&end=${String(clip.end)}`,
      tag,
    };
  }
  if (target.kind === "entry") {
    return { title: `${owner} shared ${title} with you`, path: `/library/${target.id}`, tag };
  }
  return {
    title: `${owner} shared the playlist ${title} with you`,
    path: `/shared/${target.shareId}`,
    tag,
  };
}

/** Tells each person a share newly reaches (pushed unless they turned shared-with-me pushes off). */
export async function noticeShared(
  db: Kysely<Database>,
  notify: JobQueue<NotifyJob>,
  people: readonly string[],
  message: Message,
): Promise<void> {
  for (const userId of people) {
    await sendNotice({ db, notify }, { userId, kind: "shares", message, urgency: "normal" });
  }
}
