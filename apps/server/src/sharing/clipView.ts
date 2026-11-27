import { Chapter, type ClipItem } from "@uroboros/contract";
import { z } from "zod";
import { clipCuts, clipOf, clipTitle } from "../exports/clip.ts";
import { remapChapters } from "../exports/cuts.ts";
import { thumbnailUrl } from "../library/thumbnailUrl.ts";
import type { VisibleClip } from "./clipAccess.ts";

/**
 * A clip as its viewer gets it (docs/sharing.md#clips): its own title, length and chapters, and its
 * URLs under `base` (`/api/clips/{id}`, or `/api/public/s/{code}/clip` for a link).
 */

const Chapters = z.array(Chapter);

const ms = (t: number) => Math.round(t * 1000) / 1000;

export function clipItem(row: VisibleClip, base: string): ClipItem {
  const range = clipOf(row) ?? { start: 0, end: 0 };
  const duration = row.duration ?? range.end;
  const title = row.title ?? row.video_id;
  const done = row.state === "done" && row.storage_key !== null;
  return {
    id: row.id,
    title: clipTitle(title, range),
    channel: row.channel,
    range,
    duration: ms(range.end - range.start),
    state: row.state,
    progress: row.progress,
    error: row.error,
    thumbnailUrl: thumbnailUrl(`${base}/thumbnail`, row.thumbnail_key),
    chapters: remapChapters(
      Chapters.safeParse(row.chapters).data ?? [],
      clipCuts(range, duration),
      duration,
    ),
    streamUrl: done ? `${base}/stream` : null,
    fileUrl: done && row.allow_download ? `${base}/file` : null,
    audioOnly: row.video_codec === null,
    owner: row.own ? null : row.owner_name,
  };
}
