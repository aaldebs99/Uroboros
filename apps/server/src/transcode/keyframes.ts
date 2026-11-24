import { probeKeyframes, type MediaInfo } from "@uroboros/ytdlp";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { keyframeStream } from "./facts.ts";

export interface KeyframeContext {
  db: Kysely<Database>;
  logger: Logger;
  ffprobe: { binary: string; env?: Readonly<Record<string, string>> };
}

/**
 * Indexes a rendition's keyframes (rendition_keyframes), where a remux can cut (docs/transcoding.md).
 * The fetch consumer does it while the file is on local disk; a session does it for a rendition
 * stored before. Returns the times, or null when the video is never copied or the probe failed
 * (logged: the download stands, and a remux indexes it later).
 */
export async function indexKeyframes(
  ctx: KeyframeContext,
  renditionId: string,
  input: string,
  info: MediaInfo,
): Promise<number[] | null> {
  const stream = keyframeStream(info);
  if (stream === null) return null;
  try {
    const times = await probeKeyframes(input, {
      binary: ctx.ffprobe.binary,
      ...(ctx.ffprobe.env === undefined ? {} : { env: ctx.ffprobe.env }),
      streamIndex: stream,
      startTime: info.startTime,
    });
    if (times.length === 0) return null;
    await ctx.db
      .insertInto("rendition_keyframes")
      .values({ rendition_id: renditionId, times })
      .onConflict((oc) => oc.column("rendition_id").doNothing())
      .execute();
    return times;
  } catch (err) {
    ctx.logger.warn({ err, renditionId }, "could not index the keyframes");
    return null;
  }
}
