import type { DownloadContext } from "../downloads/dispatch.ts";
import { CAPTION_INDEX_EVERY_MS, indexPendingCaptions } from "../library/captionIndex.ts";
import { periodicDuty } from "../shared/periodic.ts";
import { reapOnce, REAPER_EVERY_MS } from "../storage/reaper.ts";
import type { MediaStore } from "../storage/store.ts";
import { reconcileSessions, SESSION_DUTY_EVERY_MS } from "../transcode/sessionDuties.ts";
import { sweepUploads, UPLOAD_SWEEP_EVERY_MS } from "../uploads/sweep.ts";
import { EXPORT_SWEEP_EVERY_MS, sweepExports } from "../exports/sweep.ts";
import { PREVIEW_SWEEP_EVERY_MS, sweepPreviews } from "../previews/sweep.ts";
import { checkDueSubscriptions, DUE_EVERY_MS } from "./due.ts";
import { applyRetention, RETENTION_EVERY_MS } from "./retention.ts";

/**
 * The leader's automation duties: queue due checks every few seconds, apply retention hourly, run the reaper
 * every 15 minutes, and look after playback sessions (lost runs, abandoned and ended sessions),
 * uploads (lost jobs, abandoned and old uploads), copies to save (lost jobs), captions still to read
 * for search every minute and, unless they are off, the hover previews still to make every minute.
 */
export function automationDuties(
  ctx: DownloadContext,
  store: MediaStore,
  opts: { generatePreviews: boolean },
) {
  const due = periodicDuty(
    "due checks",
    DUE_EVERY_MS,
    () => checkDueSubscriptions(ctx),
    ctx.logger,
  );
  const retention = periodicDuty(
    "retention",
    RETENTION_EVERY_MS,
    async () => {
      const removed = await applyRetention(ctx.db);
      if (removed > 0) ctx.logger.info({ removed }, "retention removed library entries");
    },
    ctx.logger,
  );
  const reaper = periodicDuty(
    "reaper",
    REAPER_EVERY_MS,
    () => reapOnce(ctx.db, store, ctx.logger),
    ctx.logger,
  );
  const sessions = periodicDuty(
    "playback sessions",
    SESSION_DUTY_EVERY_MS,
    () => reconcileSessions(ctx),
    ctx.logger,
  );
  const uploads = periodicDuty(
    "uploads",
    UPLOAD_SWEEP_EVERY_MS,
    () => sweepUploads(ctx, store),
    ctx.logger,
  );
  const exports = periodicDuty(
    "copies to save",
    EXPORT_SWEEP_EVERY_MS,
    () => sweepExports(ctx),
    ctx.logger,
  );
  const captions = periodicDuty(
    "captions for search",
    CAPTION_INDEX_EVERY_MS,
    async () => {
      const read = await indexPendingCaptions(ctx, store);
      if (read > 0) ctx.logger.info({ read }, "read waiting captions for search");
    },
    ctx.logger,
  );
  const previews = periodicDuty(
    "hover previews",
    PREVIEW_SWEEP_EVERY_MS,
    async () => {
      await sweepPreviews(ctx);
    },
    ctx.logger,
  );
  return async (signal: AbortSignal): Promise<void> => {
    await Promise.all([
      due(signal),
      retention(signal),
      reaper(signal),
      sessions(signal),
      uploads(signal),
      exports(signal),
      captions(signal),
      ...(opts.generatePreviews ? [previews(signal)] : []),
    ]);
  };
}
