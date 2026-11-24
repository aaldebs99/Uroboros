import { DownloadErrorKind, PreviewGroup, type DownloadRequest } from "@uroboros/contract";
import type { Kysely, Selectable } from "kysely";
import { sql } from "kysely";
import { z } from "zod";
import type { Database, DownloadRequestsTable } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import type { Principal } from "../auth/guard.ts";
import { dispatchFor, queueDownload, type DownloadContext } from "./dispatch.ts";
import { publishDownloadEvent } from "./events.ts";
import { probeJobId } from "./fetchKey.ts";
import { defaultProfile, getProfile } from "./profiles.ts";
import { recordPlaylist } from "./sources.ts";

type RequestRow = Selectable<DownloadRequestsTable>;

const Groups = z.array(PreviewGroup);

export function toRequest(row: RequestRow): DownloadRequest {
  const groups = Groups.safeParse(row.entries);
  const kind = DownloadErrorKind.safeParse(row.error_kind);
  return {
    id: row.id,
    url: row.url,
    profileId: row.profile_id,
    state: row.state,
    kind: row.kind,
    title: row.title,
    groups: groups.success ? groups.data : [],
    errorKind: kind.success ? kind.data : null,
    errorMessage: row.error_message,
    stderrTail: row.stderr_tail,
    createdAt: row.created_at.toISOString(),
  };
}

/** YouTube's results page for `query`, videos only (`sp`), which yt-dlp lists as a playlist. */
export function youtubeSearchUrl(query: string): string {
  const params = new URLSearchParams({ search_query: query, sp: "EgIQAQ==" });
  return `https://www.youtube.com/results?${params.toString()}`;
}

/** Records a pasted link (or a search's results page) and asks a worker to probe it. */
export async function createRequest(
  ctx: DownloadContext,
  userId: string,
  body: {
    url: string;
    profileId?: string | undefined;
    intent?: "download" | "subscribe" | "search" | undefined;
  },
): Promise<DownloadRequest> {
  const profile =
    body.profileId === undefined
      ? await defaultProfile(ctx.db)
      : await getProfile(ctx.db, body.profileId);
  if (profile === undefined) throw new ApiError("bad_request", "no such format profile");
  // The request and its probe job commit together: a request is never left probing with no job.
  const row = await ctx.db.transaction().execute(async (tx) => {
    const created = await tx
      .insertInto("download_requests")
      .values({
        user_id: userId,
        url: body.url,
        profile_id: profile.id,
        intent: body.intent ?? "download",
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.queues.probe.add(
      "probe",
      { requestId: created.id },
      { key: probeJobId(created.id) },
      tx,
    );
    return created;
  });
  return toRequest(row);
}

/** A request the principal may see: their own (admins too: requests are personal); else 404. */
export async function findRequest(db: Kysely<Database>, principal: Principal, id: string) {
  const row = await db
    .selectFrom("download_requests")
    .selectAll()
    .where("id", "=", id)
    .where("user_id", "=", principal.userId)
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such request");
  return row;
}

/**
 * Queues the ticked entries of a previewed playlist or channel. A search's preview stays open, so
 * its results can be downloaded one by one.
 */
export async function queueSelection(
  ctx: DownloadContext,
  principal: Principal,
  id: string,
  entryIds: readonly string[],
): Promise<{ queued: number; skipped: number }> {
  const req = await findRequest(ctx.db, principal, id);
  if (req.state !== "choosing")
    throw new ApiError("conflict", "this request has no preview to queue");
  const entries = new Map(
    toRequest(req).groups.flatMap((g) => g.entries.map((e) => [e.id, e] as const)),
  );
  const wanted = [...new Set(entryIds)];
  const missing = wanted.filter((e) => !entries.has(e));
  if (missing.length > 0)
    throw new ApiError("bad_request", `not in the preview: ${missing.slice(0, 5).join(", ")}`);
  const profile = await getProfile(ctx.db, req.profile_id);
  if (profile === undefined) throw new ApiError("conflict", "the request's profile is gone");
  const result = await ctx.db.transaction().execute(async (tx) => {
    const counts = { queued: 0, skipped: 0, ids: [] as string[] };
    for (const entryId of wanted) {
      const e = entries.get(entryId);
      if (e === undefined) continue;
      const out = await queueDownload(tx, {
        userId: req.user_id,
        requestId: req.id,
        extractor: e.extractor,
        videoId: e.id,
        url: e.url,
        title: e.title,
        profile,
      });
      if (out.outcome === "skipped") counts.skipped++;
      else counts.queued++;
      if (out.downloadId !== null) counts.ids.push(out.downloadId);
    }
    if (req.kind === "playlist" && req.source_extractor !== null && req.source_id !== null) {
      await recordPlaylist(
        tx,
        req.user_id,
        {
          extractor: req.source_extractor,
          sourceId: req.source_id,
          title: req.title,
          url: req.url,
        },
        toRequest(req).groups.flatMap((g) => g.entries),
      );
    }
    if (req.intent !== "search") {
      await tx
        .updateTable("download_requests")
        .set({ state: "queued" })
        .where("id", "=", req.id)
        .execute();
    }
    return counts;
  });
  for (const downloadId of result.ids) {
    await publishDownloadEvent(ctx.db, {
      kind: "state",
      downloadId,
      userId: req.user_id,
    });
  }
  await dispatchFor(ctx, req.user_id);
  return { queued: result.queued, skipped: result.skipped };
}

/** Deletes previews nobody queued before they expired (the leader's sweeper runs it). */
export async function sweepExpiredRequests(db: Kysely<Database>): Promise<number> {
  const res = await db
    .deleteFrom("download_requests")
    .where("state", "=", "choosing")
    .where("expires_at", "<", sql<Date>`now()`)
    .executeTakeFirst();
  return Number(res.numDeletedRows);
}
