import type { Transcript, TranscriptLine } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { visibleEntry } from "../sharing/access.ts";

export interface TranscriptOptions {
  /** The track's language; without one, a video's own captions before automatic ones. */
  lang?: string | undefined;
  /** Lines starting before this second are left out. */
  fromSeconds?: number | undefined;
  maxLines: number;
}

/** A caption run's lines, cut where each begins in its text. */
function linesOf(run: { text: string; line_at: number[]; line_start: number[] }): TranscriptLine[] {
  return run.line_at.map((at, i) => ({
    start: run.line_start[i] ?? 0,
    text: run.text.slice(at, run.line_at[i + 1] ?? run.text.length).trim(),
  }));
}

/**
 * A page of a video the person may see, read from the captions indexed for search
 * (`caption_segments`): no subtitle file is opened, so a track not read yet has no lines.
 */
export async function readTranscript(
  db: Kysely<Database>,
  userId: string,
  entryId: string,
  opts: TranscriptOptions,
): Promise<Transcript> {
  const entry = await visibleEntry(db, { userId }, entryId);
  const rows = await db
    .selectFrom("subtitles")
    .select(["id", "lang", "automatic", "indexed_at"])
    .where("media_id", "=", entry.media_id)
    .orderBy("automatic")
    .orderBy("lang")
    .execute();
  const tracks = rows.map((r) => ({
    lang: r.lang,
    automatic: r.automatic,
    indexed: r.indexed_at !== null,
  }));
  const chosen = rows.find(
    (r) => r.indexed_at !== null && (opts.lang === undefined || r.lang === opts.lang),
  );
  if (chosen === undefined) {
    return { entryId, track: null, tracks, lines: [], nextFromSeconds: null };
  }
  const from = opts.fromSeconds ?? 0;
  // Every run holds at least one line; one spare covers a first run whose lines all start early.
  const runs = await db
    .selectFrom("caption_segments")
    .select(["text", "line_at", "line_start"])
    .where("subtitle_id", "=", chosen.id)
    .where("end_s", ">=", from)
    .orderBy("seq")
    .limit(opts.maxLines + 2)
    .execute();
  const lines = runs.flatMap(linesOf).filter((l) => l.start >= from);
  return {
    entryId,
    track: { lang: chosen.lang, automatic: chosen.automatic, indexed: true },
    tracks,
    lines: lines.slice(0, opts.maxLines),
    nextFromSeconds: lines.at(opts.maxLines)?.start ?? null,
  };
}
