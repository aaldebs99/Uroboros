import { SkipSegment, type Export } from "@uroboros/contract";
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
 * until they remove it (or the entry, its file or their account goes).
 */

/** Where a copy is stored; the trash trigger deletes it with its row. */
export const exportKey = (id: string): string => `.exports/${id}.mp4`;
/** One job per copy: a second ask while one is live adds none. */
export const exportJobKey = (id: string): string => `export:${id}`;

const SkipSegments = z.array(SkipSegment);
const Spans = z.array(z.object({ start: z.number(), end: z.number() }));

type ExportRow = Selectable<ExportsTable>;
type Described = ExportRow & {
  title: string | null;
  video_id: string;
  duration: number | null;
  skip_segments: unknown;
};

const iso = (d: Date) => d.toISOString();

/** Whether a copy's cuts are those the file's segments make now (a refetch can change them). */
function isCurrent(spans: readonly Span[], row: Described): boolean {
  const segments = SkipSegments.safeParse(row.skip_segments);
  const now = mergeCuts(segments.success ? segments.data : [], row.duration);
  return (
    now.length === spans.length &&
    now.every((c, i) => c.start === spans[i].start && c.end === spans[i].end)
  );
}

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
    fileUrl: row.state === "done" ? `/api/exports/${row.id}/file` : null,
    current: isCurrent(spans, row),
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
      "r.skip_segments",
      sql<number | null>`coalesce(r.duration, m.duration)`.as("duration"),
    ]);
}

/** The caller's copies, newest first. */
export async function listExports(db: Kysely<Database>, userId: string): Promise<Export[]> {
  const rows = await described(db)
    .where("x.user_id", "=", userId)
    .orderBy("x.created_at", "desc")
    .execute();
  return rows.map(describeExport);
}

/** One of the caller's copies; anyone else's is 404. */
export async function ownExport(db: Kysely<Database>, userId: string, id: string) {
  const row = await described(db)
    .where("x.id", "=", id)
    .where("x.user_id", "=", userId)
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such copy");
  return row;
}

/**
 * Asks for a copy of an entry the caller sees without its SponsorBlock segments. The same entry
 * with the same cuts already queued, running or done is answered with that copy (`created` false);
 * a failed one is made again, in its own row (reset and queued).
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
      .select(["x.id", "x.state"])
      .where("x.user_id", "=", userId)
      .where("x.entry_id", "=", entryId)
      .where(sql<boolean>`x.cuts = ${json}::jsonb`)
      .orderBy("x.created_at", "desc")
      .executeTakeFirst();
    if (same !== undefined && same.state !== "failed") return { id: same.id, created: false };
    const copyId =
      same === undefined
        ? (
            await tx
              .insertInto("exports")
              .values({
                user_id: userId,
                entry_id: entryId,
                rendition_id: entry.rendition_id,
                cuts: json,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id
        : await restart(tx, same.id);
    await ctx.queues.export.add(
      "export",
      { exportId: copyId },
      { key: exportJobKey(copyId), attempts: 2, backoff: { type: "fixed", delayMs: 30_000 } },
      tx,
    );
    return { id: copyId, created: true };
  });
  return { created: id.created, export: describeExport(await ownExport(ctx.db, userId, id.id)) };
}

/** Puts a failed copy back in the queue, as new. */
async function restart(tx: Kysely<Database>, id: string): Promise<string> {
  await tx
    .updateTable("exports")
    .set({ state: "queued", progress: null, encoder: null, error: null, finished_at: null })
    .where("id", "=", id)
    .execute();
  return id;
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
