import type {
  PlaybackEncoder,
  PlaybackMode,
  PlaybackReason,
  PlaybackSession,
} from "@uroboros/contract";

const ENCODERS: Record<PlaybackEncoder, string | null> = {
  copy: null,
  libx264: "CPU",
  nvenc: "NVIDIA GPU",
  vaapi: "GPU (VA-API)",
};

const CODECS: Record<string, string> = {
  h264: "H.264",
  hevc: "HEVC",
  vp9: "VP9",
  vp8: "VP8",
  av1: "AV1",
};

/** Why, in a few words, for an encode; null when the line says enough. */
function why(reason: PlaybackReason, videoCodec: string | null): string | null {
  const reasons: Record<PlaybackReason, string | null> = {
    picked: null,
    container: null,
    audio_unsupported: "converting the audio",
    video_unsupported: `this browser can't play ${CODECS[videoCodec ?? ""] ?? "this video"}`,
    video_not_copyable: "its format can't be streamed as it is",
  };
  return reasons[reason];
}

/** The rung a size is, by its short side (a vertical video's 720p is 720 wide). */
const rung = (s: PlaybackSession) =>
  s.width === null || s.height === null ? "" : `${String(Math.min(s.width, s.height))}p`;

/** How a session plays, as the line under the player says it. */
export function statusText(s: PlaybackSession | null, videoCodec: string | null): string {
  if (s === null) return "Direct play";
  const reason = why(s.reason, videoCodec);
  const encoder = s.encoder === null ? null : ENCODERS[s.encoder];
  const modes: Record<PlaybackMode, (string | null)[]> = {
    remux: ["Direct stream", reason],
    audio: [s.reason === "audio_unsupported" ? "Converting the audio" : "Direct stream"],
    encode: [`Transcoding to ${rung(s)}`, encoder, reason],
  };
  return modes[s.mode].filter((part): part is string => part !== null).join(" · ");
}

/** The line under the watch player: direct play, a direct stream, or a transcode and on what. */
export function PlaybackStatus({
  session,
  videoCodec,
}: {
  session: PlaybackSession | null;
  videoCodec: string | null;
}) {
  return <p className="text-xs text-muted-foreground">{statusText(session, videoCodec)}</p>;
}
