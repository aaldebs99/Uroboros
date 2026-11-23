import type { Queue } from "bullmq";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { Message } from "../push/pusher.ts";
import { wantsNotice } from "../push/prefs.ts";
import type { Urgency } from "../push/sender.ts";
import { enqueueNotice } from "../subscriptions/notices.ts";
import type { NotifyJob } from "./queues.ts";

interface Done {
  title: string;
  entryId: string | null;
}
interface Failed {
  title: string;
  message: string | null;
}

const firstThree = (titles: string[]) => titles.slice(0, 3).join("\n");

/**
 * The words for a finished request (docs/sharing.md): "Ready: <title>" opening its watch page,
 * "N videos from <request> are ready" opening the library, or, with any failure, "Failed:
 * <title>" or "k of N downloads failed" at high urgency, opening the queue.
 */
export function readyNotice(
  r: { id: string; title: string | null },
  done: Done[],
  failed: Failed[],
): { message: Message; urgency: Urgency } {
  const tag = `request-${r.id}`;
  const total = done.length + failed.length;
  const [onlyFailed] = failed;
  if (onlyFailed !== undefined && total === 1) {
    const body = onlyFailed.message ?? undefined;
    return {
      message: {
        title: `Failed: ${onlyFailed.title}`,
        ...(body ? { body } : {}),
        path: "/downloads",
        tag,
      },
      urgency: "high",
    };
  }
  if (failed.length > 0) {
    return {
      message: {
        title: `${String(failed.length)} of ${String(total)} downloads failed`,
        body: firstThree(failed.map((f) => f.title)),
        path: "/downloads",
        tag,
      },
      urgency: "high",
    };
  }
  const [only] = done;
  if (only !== undefined && total === 1) {
    return {
      message: {
        title: `Ready: ${only.title}`,
        path: only.entryId === null ? "/" : `/library/${only.entryId}`,
        tag,
      },
      urgency: "normal",
    };
  }
  const count = String(done.length);
  return {
    message: {
      title:
        r.title === null
          ? `${count} videos are ready`
          : `${count} videos from ${r.title} are ready`,
      body: firstThree(done.map((d) => d.title)),
      path: "/",
      tag,
    },
    urgency: "normal",
  };
}

/**
 * Claims a request's notification once nothing of it is pending: the conditional update lets
 * only one of two settles that finish together through.
 */
async function claim(db: Kysely<Database>, requestId: string) {
  const res = await sql<{ user_id: string; title: string | null }>`
    UPDATE download_requests r SET noticed_at = now()
    WHERE r.id = ${requestId} AND r.noticed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM downloads d
        WHERE d.request_id = r.id AND d.state IN ('queued', 'running'))
    RETURNING r.user_id, r.title`.execute(db);
  return res.rows[0];
}

async function noticeOne(db: Kysely<Database>, notify: Queue<NotifyJob>, requestId: string) {
  const r = await claim(db, requestId);
  if (r === undefined) return;
  const rows = await db
    .selectFrom("downloads as d")
    .leftJoin("library_entries as e", (j) =>
      j.onRef("e.rendition_id", "=", "d.rendition_id").onRef("e.user_id", "=", "d.user_id"),
    )
    .select(["d.state", "d.title", "d.video_id", "d.error_message", "e.id as entry_id"])
    .where("d.request_id", "=", requestId)
    .where("d.state", "in", ["done", "failed"])
    .orderBy("d.created_at")
    .orderBy("d.id")
    .execute();
  const done = rows
    .filter((d) => d.state === "done")
    .map((d) => ({ title: d.title ?? d.video_id, entryId: d.entry_id }));
  const failed = rows
    .filter((d) => d.state === "failed")
    .map((d) => ({ title: d.title ?? d.video_id, message: d.error_message }));
  if (done.length + failed.length === 0) return;
  if (!(await wantsNotice(db, r.user_id, "downloads"))) return;
  const { message, urgency } = readyNotice({ id: requestId, title: r.title }, done, failed);
  await enqueueNotice(notify, r.user_id, message, urgency);
}

/**
 * After the fetch consumer settles downloads (done, or a final failure): for each pasted link
 * they belong to, one notification once nothing of it is pending. A subscription's downloads
 * (no request) send nothing here.
 */
export async function noticeFinishedRequests(
  deps: { db: Kysely<Database>; queues: { notify: Queue<NotifyJob> } },
  downloadIds: readonly string[],
): Promise<void> {
  if (downloadIds.length === 0) return;
  const requests = await deps.db
    .selectFrom("downloads")
    .select("request_id")
    .distinct()
    .where("id", "in", downloadIds)
    .where("request_id", "is not", null)
    .where("subscription_id", "is", null)
    .execute();
  for (const { request_id } of requests) {
    if (request_id !== null) await noticeOne(deps.db, deps.queues.notify, request_id);
  }
}
