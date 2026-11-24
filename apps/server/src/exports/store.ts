import { EXPORT_KEEP_HOURS, SkipSegment, type Export } from "@uroboros/contract";
import { sql, type Kysely, type Selectable } from "kysely";
import { z } from "zod";
import type { Database } from "../db/schema.ts";
import type { ExportsTable } from "../db/exportsSchema.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { ApiError } from "../api/errors.ts";
import { visibleEntry } from "../sharing/access.ts";
import { cutSeconds, keptRanges, mergeCuts, type Span } from "./cuts.ts";

/**
 * Copies to save (docs/transcoding.md "Saving without SponsorBlock segments"): a person asks for a
 * copy of an entry they see without its SponsorBlock segments; the `export` job makes it; it stays
 * a day after it finished.
 */

export const EXPORT_KEEP_MS = EXPORT_KEEP_HOURS * 3600_000;
/** Where a copy is stored; the trash trigger and the sweep delete it with its row. */
export const exportKey = (id: string): string => `.exports/${id}.mp4`;
/** One job per copy: a second ask while one is live adds none. */
export const exportJobKey = (id: string): string => `export:${id}`;

const SkipSegments = z.array(SkipSegment);
const Spans = z.array(z.object({ start: z.number(), end: z.number() }));

type ExportRow = Selectable<ExportsTable>;
type Described = ExportRow & { title: string | null; video_id: string; duration: number | null };

const iso = (d: Date) => d.toISOString();

/** The copy as its person sees it. */
export function describeExport(row: Described): Export {
  const cuts = Spans.safeParse(row.cuts);
  const spans = cuts.success ? cuts.data : [];
  const cut = cutSeconds(spans);
  const kept = row.duration === null ? null : Math.max(0, row.duration - cut);
  return {
    id: row.id,
    entryId: row.entry_id,
    title: row.title ?? row.video_id,
    state: row.state,
    progress: row.progress,
    encoder: row.encoder,
    error: row.error,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    keptSeconds: kept,
    cutSeconds: cut,
    createdAt: iso(row.created_at),
    expiresAt:
      row.finished_at === null ? null : iso(new Date(row.finished_at.getTime() + EXPORT_KEEP_MS)),
    fileUrl: row.state === "done" ? `/api/exports/${row.id}/file` : null,
  };
}

/** Copies with what describes them: the entry's title and the file's length. */
function described(db: Kysely<Database>) {
  return db
    .selectFrom("exports as x")
    .innerJoin("renditions as r", "r.id", "x.rendition_id")
    .innerJoin("media as m", "m.id", "r.media_id")
    .selectAll("x")
    .select([
      "m.title",
      "m.video_id",
      sql<number | null>`coalesce(r.duration, m.duration)`.as("duration"),
    ]);
}

/** A copy not past its day. */
const live = sql<boolean>`(x.finished_at IS NULL OR x.finished_at > now() - make_interval(secs => ${EXPORT_KEEP_MS / 1000}))`;

/** The caller's copies not yet gone, newest first. */
export async function listExports(db: Kysely<Database>, userId: string): Promise<Export[]> {
  const rows = await described(db)
    .where("x.user_id", "=", userId)
    .where(live)
    .orderBy("x.created_at", "desc")
    .execute();
  return rows.map(describeExport);
}

/** One of the caller's copies; anyone else's (or one gone) is 404. */
export async function ownExport(db: Kysely<Database>, userId: string, id: string) {
  const row = await described(db)
    .where("x.id", "=", id)
    .where("x.user_id", "=", userId)
    .where(live)
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such copy");
  return row;
}

/**
 * Asks for a copy of an entry the caller sees without its SponsorBlock segments. The same entry
 * with the same cuts, queued, running or done and not yet gone, is answered with that copy
 * (`created` false); a failed one is asked again.
 */
export async function createExport(
  ctx: DownloadContext,
  userId: string,
  entryId: string,
): Promise<{ created: boolean; export: Export }> {
  const entry = await visibleEntry(ctx.db, { userId }, entryId);
  const r = await ctx.db
    .selectFrom("renditions as r")
    .innerJoin("media as m", "m.id", "r.media_id")
    .select([
      "r.skip_segments",
      sql<number | null>`coalesce(r.duration, m.duration)`.as("duration"),
    ])
    .where("r.id", "=", entry.rendition_id)
    .executeTakeFirstOrThrow();
  const segments = SkipSegments.safeParse(r.skip_segments);
  const cuts = mergeCuts(segments.success ? segments.data : [], r.duration);
  if (cuts.length === 0) throw new ApiError("bad_request", "this video has no segments to cut");
  if (keptRanges(cuts).every((k) => k.end !== null && k.end <= k.start)) {
    throw new ApiError("bad_request", "the segments cover the whole video");
  }
  const json = JSON.stringify(cuts satisfies Span[]);
  const id = await ctx.db.transaction().execute(async (tx) => {
    const same = await tx
      .selectFrom("exports as x")
      .select("x.id")
      .where("x.user_id", "=", userId)
      .where("x.entry_id", "=", entryId)
      .where(sql<boolean>`x.cuts = ${json}::jsonb`)
      .where("x.state", "<>", "failed")
      .where(live)
      .executeTakeFirst();
    if (same !== undefined) return { id: same.id, created: false };
    const row = await tx
      .insertInto("exports")
      .values({ user_id: userId, entry_id: entryId, rendition_id: entry.rendition_id, cuts: json })
      .returning("id")
      .executeTakeFirstOrThrow();
    await ctx.queues.export.add(
      "export",
      { exportId: row.id },
      { key: exportJobKey(row.id), attempts: 2, backoff: { type: "fixed", delayMs: 30_000 } },
      tx,
    );
    return { id: row.id, created: true };
  });
  return { created: id.created, export: describeExport(await ownExport(ctx.db, userId, id.id)) };
}

/** Removes one of the caller's copies: a running job sees it gone and stops; the file is trashed. */
export async function removeExport(
  db: Kysely<Database>,
  userId: string,
  id: string,
): Promise<void> {
  const res = await db
    .deleteFrom("exports")
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (res.numDeletedRows === 0n) throw new ApiError("not_found", "no such copy");
}
