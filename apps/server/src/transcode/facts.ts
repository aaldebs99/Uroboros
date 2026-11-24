import type { MediaInfo, MediaStream } from "@uroboros/ytdlp";
import { audioCodecString, COPYABLE_VIDEO, videoCodecString } from "./codecs.ts";

/**
 * What a rendition records about its file from ffprobe (docs/transcoding.md): the streams'
 * codecs and RFC 6381 strings, size and duration. A music file's cover art (an attached picture
 * stored as a video stream) is not its video.
 */

function streams(info: MediaInfo): {
  video: MediaStream | undefined;
  audio: MediaStream | undefined;
} {
  return {
    video: info.streams.find((s) => s.type === "video" && !s.attachedPic),
    audio: info.streams.find((s) => s.type === "audio"),
  };
}

export function renditionFacts(info: MediaInfo) {
  const { video, audio } = streams(info);
  return {
    video_codec: video?.codec ?? null,
    audio_codec: audio?.codec ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    duration: info.duration,
    video_codecs:
      video === undefined ? null : videoCodecString({ ...video, mime: video.mimeCodec }),
    audio_codecs:
      audio === undefined ? null : audioCodecString({ ...audio, mime: audio.mimeCodec }),
  };
}

/** The video stream whose keyframes a remux would cut at, or null when no session copies it. */
export function keyframeStream(info: MediaInfo): number | null {
  const { video } = streams(info);
  return video !== undefined && COPYABLE_VIDEO.has(video.codec ?? "") ? video.index : null;
}
