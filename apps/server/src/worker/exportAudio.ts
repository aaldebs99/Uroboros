import {
  audioEncoderFor,
  audioMuxerFor,
  type AudioExportPlan,
  type MediaInfo,
} from "@uroboros/ytdlp";
import { UnrecoverableError } from "../jobs/errors.ts";

/**
 * How a copy of an audio file is made (docs/transcoding.md "Saving without SponsorBlock
 * segments"): its audio stream encoded again with its own codec, into its own container (the
 * copy's `format`), its cover kept where that takes one. A codec or container a copy can't write
 * fails the copy for good, saying which.
 */
export function audioPlanFor(
  info: MediaInfo,
  copy: Omit<AudioExportPlan, "audio" | "cover" | "encoder" | "muxer"> & { format: string },
): AudioExportPlan {
  const audio = info.streams.find((s) => s.type === "audio");
  if (audio === undefined) throw new UnrecoverableError("the file has no sound or picture");
  const encoder = audioEncoderFor(audio.codec);
  if (encoder === null)
    throw new UnrecoverableError(`can't cut a ${audio.codec ?? "unknown"} file`);
  const muxer = audioMuxerFor(copy.format);
  if (muxer === null) throw new UnrecoverableError(`can't write a ${copy.format} file`);
  const cover = info.streams.find((s) => s.type === "video" && s.attachedPic);
  return {
    input: copy.input,
    output: copy.output,
    ranges: copy.ranges,
    chapters: copy.chapters,
    audio: { index: audio.index },
    cover: cover === undefined ? null : { index: cover.index },
    encoder,
    muxer,
  };
}
