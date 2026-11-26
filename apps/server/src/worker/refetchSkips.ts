import { sql } from "kysely";
import { publishDownloadEvent } from "../downloads/events.ts";
import type { SkipsJob } from "../downloads/queues.ts";
import { sponsorBlockOf } from "../library/preferences.ts";
import { refetchSource } from "../library/skipRefetch.ts";
import { sponsorSegmentsFor, storedSegments } from "../library/sponsorSegments.ts";
import { SponsorBlockError } from "../sponsorblock/client.ts";
import type { WorkerDeps } from "./deps.ts";

/** What the person who asked hears of a refetch: the `skips` event, less who and which entry. */
interface Outcome {
  found: number | null;
  error: string | null;
  total: number | null;
  highlight: boolean;
}

const FAILED = { found: null, total: null, highlight: false };

/**
 * The probe queue's `skips` jobs (docs/automation.md#sponsorblock): asks SponsorBlock for a video's
 * segments again, every category's, and its highlight, and puts them on the file, for everyone
 * whose entry it is. A failure keeps what it had. Either way the person who asked hears how it went
 * (a `skips` event: the segments their own setting shows or skips, of all SponsorBlock has, and
 * whether there is a highlight); an entry that is gone hears nothing. A quiet refresh (the entry's
 * page opening) says something only when the segments or the highlight changed, and its event is
 * marked quiet, for no toast; a failure it only logs.
 */
export function refetchSkipsProcessor(deps: WorkerDeps) {
  return async (job: { data: SkipsJob }): Promise<void> => {
    const { entryId, userId } = job.data;
    const quiet = job.data.quiet === true;
    const entry = await deps.db
      .selectFrom("library_entries as e")
      .innerJoin("renditions as r", "r.id", "e.rendition_id")
      .innerJoin("media as m", "m.id", "r.media_id")
      .select([
        "e.rendition_id",
        "r.video_codec",
        "r.skip_segments",
        "r.sponsor_highlight",
        sql<number | null>`coalesce(r.duration, m.duration)`.as("duration"),
      ])
      .where("e.id", "=", entryId)
      .where("e.user_id", "=", userId)
      .executeTakeFirst();
    if (entry === undefined) return;
    const tell = async (o: Outcome) =>
      publishDownloadEvent(deps.db, { kind: "skips", userId, entryId, ...o, quiet });
    const source = await refetchSource(deps.db, entry.rendition_id);
    if (source === null) {
      if (!quiet)
        await tell({ ...FAILED, error: "this video has no SponsorBlock segments to fetch" });
      return;
    }
    try {
      const { segments, highlight } = await deps.sponsorBlock.lookUp(
        source.videoId,
        entry.duration,
      );
      await deps.db
        .updateTable("renditions")
        .set({ skip_segments: JSON.stringify(segments), sponsor_highlight: highlight })
        .where("id", "=", entry.rendition_id)
        .execute();
      const same =
        JSON.stringify(storedSegments(entry.skip_segments)) === JSON.stringify(segments) &&
        entry.sponsor_highlight === highlight;
      if (quiet && same) return;
      const settings = await sponsorBlockOf(deps.db, userId);
      await tell({
        found: sponsorSegmentsFor(segments, settings, entry.video_codec === null).length,
        error: null,
        total: segments.length,
        highlight: highlight !== null,
      });
    } catch (err) {
      deps.logger.warn({ err, entryId, quiet }, "refetching SponsorBlock segments failed");
      if (quiet) return;
      const error = err instanceof SponsorBlockError ? err.message : "the refetch failed";
      await tell({ ...FAILED, error });
    }
  };
}
