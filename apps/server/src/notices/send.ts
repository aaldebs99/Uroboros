import type { NoticeKind, NotificationPrefs } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { publishDownloadEvent } from "../downloads/events.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import type { JobQueue } from "../jobs/queues.ts";
import { wantsNotice } from "../push/prefs.ts";
import type { Message } from "../push/pusher.ts";
import type { Urgency } from "../push/sender.ts";
import { enqueueNotice } from "../subscriptions/notices.ts";
import { fileNotice } from "./store.ts";

/** The Settings › Notifications switch that mutes each kind's pushes; subscriptions have one each. */
const PREF = {
  downloads: "downloads",
  shares: "shares",
  groups: "groups",
  subscriptions: null,
} as const satisfies Record<NoticeKind, keyof NotificationPrefs | null>;

export interface NoticeDeps {
  db: Kysely<Database>;
  notify: JobQueue<NotifyJob>;
}

/**
 * Tells someone something (docs/push.md): files it in their list, which every open tab hears of
 * at once, then pushes it to their devices unless they muted the kind (or `push` is false: a
 * subscription's own switch). The list keeps everything; the switches only stop pushes.
 */
export async function sendNotice(
  deps: NoticeDeps,
  notice: {
    userId: string;
    kind: NoticeKind;
    message: Message;
    urgency: Urgency;
    push?: boolean;
  },
): Promise<void> {
  const { userId, kind, message, urgency } = notice;
  await fileNotice(deps.db, userId, kind, message);
  await publishDownloadEvent(deps.db, { kind: "notice", userId });
  if (notice.push === false) return;
  const pref = PREF[kind];
  if (pref !== null && !(await wantsNotice(deps.db, userId, pref))) return;
  await enqueueNotice(deps.notify, userId, message, urgency);
}
