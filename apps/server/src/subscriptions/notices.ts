import type { Queue } from "bullmq";
import type { NotifyJob } from "../downloads/queues.ts";
import type { Message } from "../push/pusher.ts";
import type { Urgency } from "../push/sender.ts";

/** Checks failed this many times in a row before the person hears about it (once). */
export const FAILING_AFTER = 3;

interface Named {
  id: string;
  title: string | null;
}

const nameOf = (sub: Named) => sub.title ?? "a subscription";
const where = (sub: Named) => ({ path: `/subscriptions/${sub.id}`, tag: `subscription-${sub.id}` });

/** "N new videos from <title>" with the first three titles; a newer one replaces it (same tag). */
export function newVideosNotice(sub: Named, titles: string[]): Message {
  return {
    title:
      titles.length === 1
        ? `New from ${nameOf(sub)}`
        : `${String(titles.length)} new videos from ${nameOf(sub)}`,
    body: titles.slice(0, 3).join("\n"),
    ...where(sub),
  };
}

export function failingNotice(sub: Named, message: string): Message {
  return { title: `${nameOf(sub)}: checks are failing`, body: message, ...where(sub) };
}

/** Queues one push for the `notify` consumer (one attempt: the sender retries on its own). */
export async function enqueueNotice(
  q: Queue<NotifyJob>,
  userId: string,
  message: Message,
  urgency: Urgency,
): Promise<void> {
  await q.add(
    "notify",
    { userId, message, urgency },
    { attempts: 1, removeOnComplete: true, removeOnFail: true },
  );
}
