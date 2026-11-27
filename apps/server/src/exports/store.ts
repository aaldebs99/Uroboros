import type { ClipRange, Export, SponsorBlockSettings } from "@uroboros/contract";
import { sql, type Kysely, type Selectable } from "kysely";
import { z } from "zod";
import type { Database } from "../db/schema.ts";
import type { ExportsTable } from "../db/exportsSchema.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { ApiError } from "../api/errors.ts";
import { sponsorBlockOf } from "../library/preferences.ts";
import { skippedSegments } from "../library/sponsorSegments.ts";
import { visibleEntry } from "../sharing/access.ts";
import { checkClip, clipCuts, clipOf } from "./clip.ts";
import { cutSeconds, mergeCuts, type Span } from "./cuts.ts";
import { exportFormatFor } from "./formats.ts";

/**
 * Copies to save (docs/transcoding.md "Saving without SponsorBlock segments"): a person asks for a
 * copy of an entry they see without its SponsorBlock segments; the `export` job makes it; it stays
 * until they remove it (or the entry, its file or their account goes).
 */

/**
 * Where a copy is stored, by its format (extension; a video's is mp4); the trash trigger deletes it
 * with its row.
 */
export const exportKey = (id: string, format = "mp4"): string => `.exports/${id}.${format}`;

/** One job per copy: a second ask while one is live adds none. */
export const exportJobKey = (id: string): string => `export:${id}`;

const Spans = z.array(z.object({ start: z.number(), end: z.number() }));

type ExportRow = Selectable<ExportsTable>;
type Described = ExportRow & {
  title: string | null;
  video_id: string;
  duration: number | null;
  skip_segments: unknown;
  video_codec: string | null;
};

/**
 * The spans a copy for someone with `settings` cuts: the file's segments they skip (by the audio
 * choice for a file without video), merged as the player joins them.
 */
function cutsFor(
  r: { skip_segments: unknown; video_codec: string | null; duration: number | null },
  settings: SponsorBlockSettings,
): Span[] {
  return mergeCuts(skippedSegments(r.skip_segments, settings, r.video_codec === null), r.duration);
}

const iso = (d: Date) => d.toISOString();

/**
 * Whether a copy's cuts are those its person would get now: a refetch can change the file's
 * segments, and they can change what they skip.
 */
function isCurrent(
  spans: readonly Span[],
  row: Described,
  settings: SponsorBlockSettings,
): boolean {
  const now = cutsFor(row, settings);
  return (
    now.length === spans.length &&
    now.every((c, i) => {
      const s = spans.at(i);
      return s !== undefined && c.start === s.start && c.end === s.end;
    })
  );
}

const ms = (t: number) => Math.round(t * 1000) / 1000;

/**
 * The copy as its person (whose SponsorBlock setting is `settings`) sees it. A clip keeps its range
 * and is always current: nothing in it depends on what is skipped.
 */
export function describeExport(row: Described, settings: SponsorBlockSettings): Export {
  const cuts = Spans.safeParse(row.cuts);
  const spans = cuts.success ? cuts.data : [];
  const cut = cutSeconds(spans);
  const clip = clipOf(row);
  const kept =
    clip !== null
      ? ms(clip.end - clip.start)
      : row.duration === null
        ? null
        : Math.max(0, row.duration - cut);
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
    current: clip !== null || isCurrent(spans, row, settings),
    clip,
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
      "r.video_codec",
      sql<number | null>`coalesce(r.duration, m.duration)`.as("duration"),
    ]);
}

/** The caller's copies, newest first. */
export async function listExports(db: Kysely<Database>, userId: string): Promise<Export[]> {
  const [rows, settings] = await Promise.all([
    described(db)
      .where("x.user_id", "=", userId)
      .orderBy("x.created_at", "desc")
      .orderBy("x.id", "desc")
      .execute(),
    sponsorBlockOf(db, userId),
  ]);
  return rows.map((row) => describeExport(row, settings));
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

interface CopySource {
  skip_segments: unknown;
  video_codec: string | null;
  duration: number | null;
}

/**
 * What a copy keeps: a clip's range with its complement as the cuts (which a worker of the release
 * before reads), or the SponsorBlock segments `userId` skips. A copy without sponsors needs something
 * to cut, and something left once cut.
 */
async function copySpec(
  ctx: DownloadContext,
  userId: string,
  r: CopySource,
  asked: ClipRange | undefined,
): Promise<{ cuts: Span[]; clip: ClipRange | null }> {
  if (asked !== undefined) {
    const clip = checkClip(asked, r.duration);
    return { cuts: clipCuts(clip, r.duration ?? clip.end), clip };
  }
  const cuts = cutsFor(r, await sponsorBlockOf(ctx.db, userId));
  if (cuts.length === 0)
    throw new ApiError("bad_request", "nothing in this file is skipped to cut");
  // The last kept range runs to the file's end, so a known length tells whether anything is left.
  if (r.duration !== null && cutSeconds(cuts) >= r.duration) {
    throw new ApiError("bad_request", "the skipped segments cover the whole file");
  }
  return { cuts, clip: null };
}

/**
 * Asks for a copy of an entry the caller sees: without the SponsorBlock segments they skip, or with
 * `clip` of just that range (docs/sharing.md#clips). The same entry with the same cuts (a clip: the
 * same range) already queued, running or done is answered with that copy (`created` false); a
 * failed one is made again, in its own row (reset and queued). A clip and a copy without sponsors
 * never answer for each other.
 */
export async function createExport(
  ctx: DownloadContext,
  userId: string,
  entryId: string,
  asked?: ClipRange,
): Promise<{ created: boolean; export: Export }> {
  const entry = await visibleEntry(ctx.db, { userId }, entryId);
  const r = await ctx.db
    .selectFrom("renditions as r")
    .innerJoin("media as m", "m.id", "r.media_id")
    .select([
      "r.skip_segments",
      "r.video_codec",
      "r.container",
      sql<number | null>`coalesce(r.duration, m.duration)`.as("duration"),
    ])
    .where("r.id", "=", entry.rendition_id)
    .executeTakeFirstOrThrow();
  const format = exportFormatFor(r);
  if (format === null) {
    throw new ApiError("bad_request", `a copy can't be made of a ${r.container ?? "this"} file`);
  }
  const { cuts, clip } = await copySpec(ctx, userId, r, asked);
  const json = JSON.stringify(cuts satisfies Span[]);
  const id = await ctx.db.transaction().execute(async (tx) => {
    let same = tx
      .selectFrom("exports as x")
      .select(["x.id", "x.state"])
      .where("x.user_id", "=", userId)
      .where("x.entry_id", "=", entryId);
    same =
      clip === null
        ? same.where("x.clip_start", "is", null).where(sql<boolean>`x.cuts = ${json}::jsonb`)
        : same.where("x.clip_start", "=", clip.start).where("x.clip_end", "=", clip.end);
    const found = await same.orderBy("x.created_at", "desc").executeTakeFirst();
    if (found !== undefined && found.state !== "failed") return { id: found.id, created: false };
    const copyId =
      found === undefined
        ? (
            await tx
              .insertInto("exports")
              .values({
                user_id: userId,
                entry_id: entryId,
                rendition_id: entry.rendition_id,
                cuts: json,
                format,
                clip_start: clip?.start ?? null,
                clip_end: clip?.end ?? null,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id
        : await restart(tx, found.id);
    await ctx.queues.export.add(
      "export",
      { exportId: copyId },
      { key: exportJobKey(copyId), attempts: 2, backoff: { type: "fixed", delayMs: 30_000 } },
      tx,
    );
    return { id: copyId, created: true };
  });
  return {
    created: id.created,
    export: describeExport(
      await ownExport(ctx.db, userId, id.id),
      await sponsorBlockOf(ctx.db, userId),
    ),
  };
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
