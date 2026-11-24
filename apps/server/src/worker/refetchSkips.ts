import { probe, YtDlpError } from "@uroboros/ytdlp";
import { toDownloadError } from "../downloads/errors.ts";
import { publishDownloadEvent } from "../downloads/events.ts";
import type { SkipsJob } from "../downloads/queues.ts";
import { refetchSource } from "../library/skipRefetch.ts";
import type { WorkerDeps } from "./deps.ts";
import { withLoginsOf } from "./logins.ts";
import { ytdlpOptions } from "./probe.ts";
import { skipSegmentsFor } from "./skipSegments.ts";

/** Why a refetch failed, for its person: yt-dlp's own last error line when it has no kind for it. */
function failureText(err: unknown): string {
  if (err instanceof YtDlpError && err.kind === "unknown") {
    const line = [...err.stderrTail].reverse().find((l) => l.startsWith("ERROR: "));
    if (line !== undefined) return line.slice("ERROR: ".length).slice(0, 300);
  }
  return toDownloadError(err).message;
}

/**
 * The probe queue's `skips` jobs (docs/automation.md#sponsorblock): asks yt-dlp for a video's
 * SponsorBlock segments again, with the categories its file was made with, and puts what the player
 * skips on the file, for everyone whose entry it is. A failure keeps the segments it had. Either
 * way the person who asked hears how it went (a `skips` event); an entry that is gone hears nothing.
 */
export function refetchSkipsProcessor(deps: WorkerDeps) {
  return async (job: { data: SkipsJob }): Promise<void> => {
    const { entryId, userId } = job.data;
    const entry = await deps.db
      .selectFrom("library_entries")
      .select("rendition_id")
      .where("id", "=", entryId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (entry === undefined) return;
    const outcome = async (found: number | null, error: string | null) =>
      publishDownloadEvent(deps.db, { kind: "skips", userId, entryId, found, error });
    const source = await refetchSource(deps.db, entry.rendition_id);
    if (source === null) {
      await outcome(null, "this video has no SponsorBlock segments to fetch");
      return;
    }
    const categories = [...(source.args.sponsorblockRemove ?? [])].sort().join(",");
    try {
      const info = await probe(source.url, {
        ...ytdlpOptions(await withLoginsOf(deps, userId)),
        flat: false,
        extraArgs: [`--sponsorblock-mark=${categories}`],
      });
      if (info.kind !== "video" || info.sponsorSegments === null) {
        await outcome(null, "SponsorBlock was not asked about this video");
        return;
      }
      const segments = skipSegmentsFor(source.args, info.sponsorSegments);
      await deps.db
        .updateTable("renditions")
        .set({ skip_segments: JSON.stringify(segments) })
        .where("id", "=", entry.rendition_id)
        .execute();
      await outcome(segments.length, null);
    } catch (err) {
      deps.logger.warn({ err, entryId }, "refetching SponsorBlock segments failed");
      await outcome(null, failureText(err));
    }
  };
}
