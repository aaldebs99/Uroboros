import { noticeFinishedRequests } from "../downloads/requestNotices.ts";
import { noticeNewVideos } from "../subscriptions/videoNotices.ts";
import type { WorkerDeps } from "./deps.ts";

/**
 * What the fetch consumer says once downloads settle (done, or a final failure): a pasted link's
 * "Ready" once nothing of it is pending, and a subscription's "New from" for each new video.
 */
export async function noticeSettled(deps: WorkerDeps, downloadIds: readonly string[]) {
  await noticeFinishedRequests(deps, downloadIds);
  await noticeNewVideos(deps, downloadIds);
}
