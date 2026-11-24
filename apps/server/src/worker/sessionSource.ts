import { ffprobe, type MediaStream } from "@uroboros/ytdlp";
import { sql } from "kysely";
import { indexKeyframes } from "../transcode/keyframes.ts";
import type { SourceStreams } from "../transcode/runPlan.ts";
import type { SessionRow } from "../transcode/sessions.ts";
import { keyframeBoundaries } from "../transcode/timeline.ts";
import type { WorkerDeps } from "./deps.ts";

/** A session's source, ready for runs (docs/transcoding.md). */
export interface PreparedSource {
  /** The file's path (filesystem store) or a presigned URL (S3): ffmpeg reads it in place. */
  input: string;
  streams: SourceStreams;
  boundaries: number[];
  /** What decides whether a GPU decodes it (hwaccel.ts). */
  video: MediaStream | null;
}

/** A failure that ends the session with its message. */
export class SessionError extends Error {}

const HDR = new Set(["smpte2084", "arib-std-b67"]);

/** Finds the file, reads its streams, and, for a remux stored before, its keyframes. */
export async function prepareSource(
  deps: WorkerDeps,
  row: SessionRow,
  signal: AbortSignal,
): Promise<PreparedSource> {
  const r = await deps.db
    .selectFrom("renditions as r")
    .innerJoin("media as m", "m.id", "r.media_id")
    .select(["r.storage_key", sql<number | null>`coalesce(r.duration, m.duration)`.as("duration")])
    .where("r.id", "=", row.rendition_id)
    .executeTakeFirstOrThrow();
  const input = deps.store.localPath(r.storage_key) ?? (await deps.store.readUrl(r.storage_key));
  if (input === null) throw new SessionError("the stored file can't be read");
  const t = deps.transcoder;
  const info = await ffprobe(input, {
    binary: t.ffprobe.binary,
    ...(t.ffprobe.env === undefined ? {} : { env: t.ffprobe.env }),
    signal,
  });
  const video = info.streams.find((s) => s.type === "video" && !s.attachedPic) ?? null;
  const audio = info.streams.find((s) => s.type === "audio") ?? null;
  const transfer = video?.colorTransfer ?? "";
  const streams: SourceStreams = {
    video: video === null ? null : { index: video.index, codec: video.codec, pixFmt: video.pixFmt },
    audio: audio === null ? null : { index: audio.index },
    hdr: HDR.has(transfer) ? (transfer as "smpte2084" | "arib-std-b67") : null,
  };
  const boundaries = row.boundaries ?? (await remuxBoundaries(deps, row, input, info, r.duration));
  return { input, streams, boundaries, video };
}

/** Indexes the keyframes of a rendition stored before indexing existed, and records the cuts. */
async function remuxBoundaries(
  deps: WorkerDeps,
  row: SessionRow,
  input: string,
  info: Awaited<ReturnType<typeof ffprobe>>,
  storedDuration: number | null,
): Promise<number[]> {
  const ctx = { db: deps.db, logger: deps.logger, ffprobe: deps.transcoder.ffprobe };
  const times = await indexKeyframes(ctx, row.rendition_id, input, info);
  const duration = info.duration ?? storedDuration;
  if (times === null || duration === null) {
    throw new SessionError("the video's keyframes could not be read");
  }
  const boundaries = keyframeBoundaries(times, duration);
  await deps.db
    .updateTable("playback_sessions")
    .set({ boundaries })
    .where("id", "=", row.id)
    .execute();
  return boundaries;
}
