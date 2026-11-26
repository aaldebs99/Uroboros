import { z } from "@hono/zod-openapi";

/**
 * Playback sessions (docs/transcoding.md): an entry played other than directly, remuxed or
 * transcoded on the fly for one viewer, seekable anywhere.
 */

/** What a viewer picks: Original (direct play, or the least change that plays), or a rung. */
export const Quality = z
  .enum(["original", "2160", "1440", "1080", "720", "480", "360"])
  .openapi("Quality");
export type Quality = z.infer<typeof Quality>;

/** The ladder's rungs, by lines on the short side, best first. */
export const QUALITY_RUNGS = ["2160", "1440", "1080", "720", "480", "360"] as const;
export type QualityRung = (typeof QUALITY_RUNGS)[number];

/** What a player needs to decide how to play an item (on LibraryItem and PublicItem). */
export const PlaybackFacts = z.object({
  /** RFC 6381 strings: with `container`, what this browser is asked about. */
  videoCodecs: z.string().nullable(),
  audioCodecs: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** The rungs this video offers, best first: those up to its short side. */
  qualities: z.array(z.enum(QUALITY_RUNGS)),
});
export type PlaybackFacts = z.infer<typeof PlaybackFacts>;

export const PlaybackMode = z.enum(["remux", "encode", "audio"]).openapi("PlaybackMode");
export type PlaybackMode = z.infer<typeof PlaybackMode>;

/** What does the work: `copy` (a remux), the CPU (`libx264`), or a GPU. */
export const PlaybackEncoder = z
  .enum(["copy", "libx264", "nvenc", "vaapi"])
  .openapi("PlaybackEncoder");
export type PlaybackEncoder = z.infer<typeof PlaybackEncoder>;

/** Why it is not direct play, for the page's status line. */
export const PlaybackReason = z
  .enum(["picked", "container", "audio_unsupported", "video_unsupported", "video_not_copyable"])
  .openapi("PlaybackReason");
export type PlaybackReason = z.infer<typeof PlaybackReason>;

export const SessionState = z
  .enum(["queued", "starting", "running", "stopped", "failed"])
  .openapi("SessionState");
export type SessionState = z.infer<typeof SessionState>;

export const PlaybackRequest = z
  .object({
    quality: Quality,
    /** Where the viewer is, in seconds: the first run starts at the segment holding it. */
    start: z.number().min(0),
    /** Whether this browser decodes the file's video / audio from fragmented MP4. */
    copyVideo: z.boolean(),
    copyAudio: z.boolean(),
  })
  .openapi("PlaybackRequest");
export type PlaybackRequest = z.infer<typeof PlaybackRequest>;

export const PlaybackSession = z
  .object({
    id: z.uuid(),
    state: SessionState,
    mode: PlaybackMode,
    quality: Quality,
    /** Known once it runs. */
    encoder: PlaybackEncoder.nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    /** The encode's target bits per second; null when the video is copied (or none). */
    bitrate: z.number().int().nullable().default(null),
    reason: PlaybackReason,
    /** The session itself: GET it to stay alive, DELETE it to stop. */
    url: z.string(),
    /** The multivariant playlist to play once it runs. */
    masterUrl: z.string(),
    error: z.string().nullable(),
  })
  .openapi("PlaybackSession");
export type PlaybackSession = z.infer<typeof PlaybackSession>;
