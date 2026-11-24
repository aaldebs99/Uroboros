import { randomBytes } from "node:crypto";
import { UPLOAD_EXTRACTOR } from "../library/platform.ts";
import type { StorageConfig } from "../storage/config.ts";
import { renderLayout, sanitizeSegment, type MediaNames } from "../storage/layout.ts";

/** What an upload's file is named from: its creator, title, id and the day it came in. */
export interface UploadNaming {
  uploadId: string;
  mediaId: string;
  creator: string;
  title: string;
  ext: string;
  /** YYYYMMDD, the day it was uploaded. */
  day: string;
}

const names = (u: UploadNaming): MediaNames => ({
  extractor: UPLOAD_EXTRACTOR,
  id: u.uploadId,
  title: u.title,
  channel: u.creator,
  uploader: u.creator,
  uploadDate: u.day,
  profile: "upload",
  ext: u.ext,
});

/**
 * Where an upload's file goes: `media/<media id>/upload.<ext>` on S3; on a filesystem the layout,
 * with the creator as the channel. Every layout holds `{id}` (the upload's), so no two meet.
 */
export function uploadKey(config: StorageConfig, u: UploadNaming): string {
  if (config.kind === "s3") return `media/${u.mediaId}/upload.${u.ext}`;
  return renderLayout(config.layout, names(u));
}

/**
 * A fresh key for an upload's thumbnail, beside its file: random each time, so a replaced
 * thumbnail never reuses the old one's key (or its cached URL).
 */
export function uploadThumbnailKey(
  config: StorageConfig,
  mediaKey: string,
  mediaId: string,
  title: string,
  ext: string,
): string {
  const tag = randomBytes(4).toString("hex");
  if (config.kind === "s3") return `media/${mediaId}/thumbnail-${tag}.${ext}`;
  const dir = mediaKey.includes("/") ? mediaKey.slice(0, mediaKey.lastIndexOf("/") + 1) : "";
  return `${dir}${sanitizeSegment(title)} [${tag}].${ext}`;
}

/** YYYYMMDD of `at`, in UTC. */
export const dayOf = (at: Date): string => at.toISOString().slice(0, 10).replaceAll("-", "");
