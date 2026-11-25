import { sql } from "kysely";
import { publishDownloadEvent } from "../downloads/events.ts";
import type { SkipsJob } from "../downloads/queues.ts";
import { sponsorBlockOf } from "../library/preferences.ts";
import { refetchSource } from "../library/skipRefetch.ts";
import { sponsorSegmentsFor } from "../library/sponsorSegments.ts";
import { SponsorBlockError } from "../sponsorblock/client.ts";
import type { WorkerDeps } from "./deps.ts";

/**
 * The probe queue's `skips` jobs (docs/automation.md#sponsorblock): asks SponsorBlock for a video's
 * segments again, every category's, and its highlight, and puts them on the file, for everyone
 * whose entry it is. A failure keeps what it had. Either way the person who asked hears how it went
 * (a `skips` event, counting the segments their own setting shows or skips, not the highlight); an
 * entry that is gone hears nothing.
 */
export function refetchSkipsProcessor(deps: WorkerDeps) {
  return async (job: { data: SkipsJob }): Promise<void> => {
    const { entryId, userId } = job.data;
    const entry = await deps.db
      .selectFrom("library_entries as e")
      .innerJoin("renditions as r", "r.id", "e.rendition_id")
      .innerJoin("media as m", "m.id", "r.media_id")
      .select([
        "e.rendition_id",
        "r.video_codec",
        sql<number | null>`coalesce(r.duration, m.duration)`.as("duration"),
      ])
      .where("e.id", "=", entryId)
      .where("e.user_id", "=", userId)
      .executeTakeFirst();
    if (entry === undefined) return;
    const outcome = async (found: number | null, error: string | null) =>
      publishDownloadEvent(deps.db, { kind: "skips", userId, entryId, found, error });
    const source = await refetchSource(deps.db, entry.rendition_id);
    if (source === null) {
      await outcome(null, "this video has no SponsorBlock segments to fetch");
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
      const settings = await sponsorBlockOf(deps.db, userId);
      await outcome(
        sponsorSegmentsFor(segments, settings, entry.video_codec === null).length,
        null,
      );
    } catch (err) {
      deps.logger.warn({ err, entryId }, "refetching SponsorBlock segments failed");
      await outcome(null, err instanceof SponsorBlockError ? err.message : "the refetch failed");
    }
  };
}
