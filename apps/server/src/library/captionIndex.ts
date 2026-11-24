import { sql, type Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { lockKey } from "../shared/lockKeys.ts";
import type { MediaStore } from "../storage/store.ts";
import { parseVtt, type CaptionSegment } from "./vtt.ts";

/**
 * Captions read into `caption_segments` for search (docs/library.md "Search"): one track per
 * language, at most 3 languages a video, read as each download stores them and, for any left
 * waiting (a read that failed, or `UPDATE subtitles SET indexed_at = NULL` to read them all
 * again), by the leader's catch-up duty.
 */

export const CAPTION_INDEX_EVERY_MS = 60_000;
/** Languages read per video. */
export const MAX_CAPTION_TRACKS = 3;
/** Failed reads after which a track is given up. */
export const MAX_INDEX_FAILURES = 3;
/** How much of a file is read; the rest of a larger one is left out. */
export const MAX_CAPTION_BYTES = 16 * 1024 * 1024;
const MEDIA_PER_PASS = 50;
const PASS_BUDGET_MS = 20_000;
const INSERT_BATCH = 500;

interface Context {
  db: Kysely<Database>;
  logger: Logger;
}

export interface CaptionTrack {
  id: string;
  lang: string;
  automatic: boolean;
  index_failures: number;
  storage_key: string;
}

/** Reads a subtitle file by its storage key. */
export type ReadCaptions = (key: string) => Promise<string>;

const baseOf = (lang: string) => (lang.split("-")[0] ?? lang).toLowerCase();

/** Lower is better: manual, then the original (`en-orig`), then the plain code, then by name. */
function better(a: CaptionTrack, b: CaptionTrack): number {
  const rank = (t: CaptionTrack) => [
    t.automatic ? 1 : 0,
    t.lang.toLowerCase().endsWith("-orig") ? 0 : 1,
    t.lang.toLowerCase() === baseOf(t.lang) ? 0 : 1,
  ];
  const [ra, rb] = [rank(a), rank(b)];
  for (let i = 0; i < ra.length; i++) {
    const d = (ra[i] ?? 0) - (rb[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.lang.localeCompare(b.lang);
}

/**
 * The tracks to read: the best of each language (by its code before any `-`), those with a manual
 * track first, at most `MAX_CAPTION_TRACKS`; a track that failed `MAX_INDEX_FAILURES` times never.
 */
export function pickCaptionTracks<T extends CaptionTrack>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (row.index_failures >= MAX_INDEX_FAILURES) continue;
    const base = baseOf(row.lang);
    const held = best.get(base);
    if (held === undefined || better(row, held) < 0) best.set(base, row);
  }
  return [...best.entries()]
    .sort(([la, a], [lb, b]) => Number(a.automatic) - Number(b.automatic) || la.localeCompare(lb))
    .slice(0, MAX_CAPTION_TRACKS)
    .map(([, row]) => row);
}

async function insertSegments(
  tx: Kysely<Database>,
  mediaId: string,
  subtitleId: string,
  segments: CaptionSegment[],
) {
  const rows = segments.map((s, seq) => ({
    subtitle_id: subtitleId,
    media_id: mediaId,
    seq,
    start_s: s.start,
    end_s: s.end,
    text: s.text,
    line_at: s.lineAt,
    line_start: s.lineStart,
  }));
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await tx
      .insertInto("caption_segments")
      .values(rows.slice(i, i + INSERT_BATCH))
      .execute();
  }
}

/**
 * Reads `mediaId`'s captions into `caption_segments`, replacing what it had, and marks its tracks
 * read. One read failing counts against that track and writes nothing else: the duty tries again,
 * and a track that keeps failing is given up. Serialised per media, so the last to run reads the
 * newest files. With `onlyIfPending`, a media none of whose tracks waits is left as it is.
 */
export async function indexMediaCaptions(
  ctx: Context,
  mediaId: string,
  read: ReadCaptions,
  opts: { onlyIfPending?: boolean } = {},
): Promise<"indexed" | "failed" | "skipped"> {
  return ctx.db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(${lockKey("CAPS", mediaId)})`.execute(tx);
    const rows = await tx
      .selectFrom("subtitles")
      .select(["id", "lang", "automatic", "index_failures", "storage_key", "indexed_at"])
      .where("media_id", "=", mediaId)
      .execute();
    const waiting = rows.some(
      (r) => r.indexed_at === null && r.index_failures < MAX_INDEX_FAILURES,
    );
    if (opts.onlyIfPending === true && !waiting) return "skipped";
    const parsed: { id: string; segments: CaptionSegment[] }[] = [];
    for (const track of pickCaptionTracks(rows)) {
      try {
        parsed.push({ id: track.id, segments: parseVtt(await read(track.storage_key)) });
      } catch (err) {
        ctx.logger.warn({ err, mediaId, lang: track.lang }, "reading captions for search failed");
        await tx
          .updateTable("subtitles")
          .set({ index_failures: sql`index_failures + 1` })
          .where("id", "=", track.id)
          .execute();
        return "failed";
      }
    }
    await tx.deleteFrom("caption_segments").where("media_id", "=", mediaId).execute();
    for (const t of parsed) await insertSegments(tx, mediaId, t.id, t.segments);
    await tx
      .updateTable("subtitles")
      .set({ indexed_at: sql`now()`, index_failures: 0 })
      .where("media_id", "=", mediaId)
      .where("index_failures", "<", MAX_INDEX_FAILURES)
      .execute();
    return "indexed";
  });
}

/** Reads a subtitle file from the store, at most `MAX_CAPTION_BYTES` of it. */
export function storeReader(store: MediaStore): ReadCaptions {
  return async (key) => {
    const found = await store.stat(key);
    if (found === null) throw new Error(`no subtitle file at ${key}`);
    if (found.size === 0) return "";
    const range =
      found.size > MAX_CAPTION_BYTES ? { start: 0, end: MAX_CAPTION_BYTES - 1 } : undefined;
    const file = await store.open(key, range);
    return new Response(file.body).text();
  };
}

/**
 * One pass of the catch-up duty: reads the captions of up to 50 media with a track waiting, for at
 * most 20 seconds. Returns how many it read.
 */
export async function indexPendingCaptions(ctx: Context, store: MediaStore): Promise<number> {
  const pending = await ctx.db
    .selectFrom("subtitles")
    .select("media_id")
    .distinct()
    .where("indexed_at", "is", null)
    .where("index_failures", "<", MAX_INDEX_FAILURES)
    .limit(MEDIA_PER_PASS)
    .execute();
  const started = Date.now();
  const read = storeReader(store);
  let indexed = 0;
  for (const { media_id } of pending) {
    if (Date.now() - started > PASS_BUDGET_MS) break;
    try {
      const outcome = await indexMediaCaptions(ctx, media_id, read, { onlyIfPending: true });
      if (outcome === "indexed") indexed++;
    } catch (err) {
      ctx.logger.warn({ err, mediaId: media_id }, "indexing captions for search failed");
    }
  }
  return indexed;
}
