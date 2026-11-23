import { createHash } from "node:crypto";
import type { TranscodeEncoder } from "../db/schema.ts";

/** The compatible copy's encode settings (docs/transcoding.md). Change one and new copies are made. */
export const TRANSCODE = {
  segmentSeconds: 6,
  crf: 23,
  preset: "veryfast",
  maxHeight: 1080,
  audioKbps: 160,
} as const;

/** A short hash of the settings and the encoder: a copy's identity beside its source. */
export function settingsRevision(encoder: TranscodeEncoder): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...TRANSCODE, encoder }))
    .digest("hex")
    .slice(0, 12);
}
