/**
 * Large downloads wait for their owner's OK (docs/downloads.md "Large downloads"). yt-dlp says the
 * size of the formats it picked before it downloads them; when that is over
 * `UROBOROS_LARGE_DOWNLOAD_BYTES` and nobody waiting on the fetch has said yes, the fetch stops
 * there and every download waiting on it is held, queued and undispatched, until its owner
 * confirms it (`confirmDownload`), and each owner is told.
 */
import type { PickedSize } from "@uroboros/ytdlp";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { dispatchFor } from "../downloads/dispatch.ts";
import { publishDownloadEvents } from "../downloads/events.ts";
import type { FetchJob } from "../downloads/queues.ts";
import { sendNotice } from "../notices/send.ts";
import type { WorkerDeps } from "./deps.ts";

const ACTIVE = ["queued", "running"] as const;

/** Why a fetch's run was stopped: what yt-dlp picked is larger than the limit. */
export class TooLarge extends Error {
  override readonly name = "TooLarge";
  constructor(readonly bytes: number) {
    super(`the download would be about ${String(bytes)} bytes`);
  }
}

/** 36723094732 → "34.2 GB", 32212254720 → "30 GB": as the web app writes sizes. */
export function bytesText(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const shown = unit === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${shown} ${units[unit] ?? "B"}`;
}

async function anyConfirmed(db: Kysely<Database>, fetchKey: string): Promise<boolean> {
  const row = await db
    .selectFrom("downloads")
    .select("id")
    .where("fetch_key", "=", fetchKey)
    .where("state", "in", ACTIVE)
    .where("size_ok_at", "is not", null)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * What a fetch's run hears of its size: it aborts `controller` with `TooLarge` when the size is
 * over the limit and nobody waiting said yes. An unknown size (a live stream) goes ahead.
 */
export async function sizeGate(
  deps: Pick<WorkerDeps, "db" | "limits">,
  fetchKey: string,
  controller: AbortController,
): Promise<(size: PickedSize) => void> {
  const limit = deps.limits.largeDownloadBytes;
  const allowed = limit === 0 || (await anyConfirmed(deps.db, fetchKey));
  return (size) => {
    if (allowed || size.bytes === null || size.bytes <= limit || controller.signal.aborted) return;
    controller.abort(new TooLarge(size.bytes));
  };
}

/**
 * Holds every download waiting on the fetch: back to queued and undispatched, with yt-dlp's
 * estimate. Each owner hears of it (a notice, pushed unless they muted downloads), and their freed
 * slots go to their next downloads.
 */
export async function holdForSize(deps: WorkerDeps, data: FetchJob, bytes: number): Promise<void> {
  const held = await deps.db
    .updateTable("downloads")
    .set({
      state: "queued",
      dispatched_at: null,
      started_at: null,
      size_held_bytes: bytes,
      size_held_at: new Date(),
    })
    .where("fetch_key", "=", data.fetchKey)
    .where("state", "in", ACTIVE)
    .returning(["id", "user_id", "title", "video_id"])
    .execute();
  deps.logger.info({ fetchKey: data.fetchKey, bytes, held: held.length }, "large download held");
  await publishDownloadEvents(
    deps.db,
    held.map((r) => ({ kind: "state", downloadId: r.id, userId: r.user_id })),
  );
  const limit = bytesText(deps.limits.largeDownloadBytes);
  for (const r of held) {
    await sendNotice(
      { db: deps.db, notify: deps.queues.notify },
      {
        userId: r.user_id,
        kind: "downloads",
        message: {
          title: "Large download needs your OK",
          body: `${r.title ?? r.video_id} is about ${bytesText(bytes)}, over the ${limit} limit.`,
          path: "/downloads",
          tag: `large:${r.id}`,
        },
        urgency: "normal",
      },
    );
  }
  for (const userId of new Set(held.map((r) => r.user_id))) await dispatchFor(deps, userId);
}
