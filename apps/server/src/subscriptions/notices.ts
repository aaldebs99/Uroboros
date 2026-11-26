import type { NotifyJob } from "../downloads/queues.ts";
import type { JobQueue } from "../jobs/queues.ts";
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

/**
 * "N new videos from <title>" with the first three titles, opening the subscription: the videos a
 * check left `new` for the person to pick (auto-download off). A newer one replaces it (same tag).
 */
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

/** One of a subscription's new videos, as its notice names it. */
interface NewVideo {
  downloadId: string;
  title: string;
}

/**
 * "New from <title>" once a new video is in the library, opening it; each video keeps its own
 * notice on a device (a tag of its own), so tapping one opens that video.
 */
export function newVideoNotice(sub: Named, video: NewVideo & { entryId: string }): Message {
  return {
    title: `New from ${nameOf(sub)}`,
    body: video.title,
    path: `/library/${video.entryId}`,
    tag: `subscription-video-${video.downloadId}`,
  };
}

/** The same notice for a new video whose download failed for good, opening Downloads. */
export function failedVideoNotice(sub: Named, video: NewVideo): Message {
  return {
    title: `New from ${nameOf(sub)}`,
    body: `${video.title}: the download failed`,
    path: "/downloads",
    tag: `subscription-video-${video.downloadId}`,
  };
}

export function failingNotice(sub: Named, message: string): Message {
  return { title: `${nameOf(sub)}: checks are failing`, body: message, ...where(sub) };
}

/**
 * Queues one push for the `notify` consumer (one attempt: the sender retries on its own). Features
 * call `sendNotice` (notices/send.ts), which files the notice in the person's list first.
 */
export async function enqueueNotice(
  q: JobQueue<NotifyJob>,
  userId: string,
  message: Message,
  urgency: Urgency,
): Promise<void> {
  await q.add("notify", { userId, message, urgency });
}
