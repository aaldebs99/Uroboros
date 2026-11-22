import { z } from "zod";
import { bool, list, listRecord, num, str } from "./lenient.ts";

/**
 * The parts of yt-dlp's info JSON (`--dump-single-json` and the `.info.json` it writes) that
 * Uroboros uses, in camelCase. Only `id` is required; see `lenient.ts` for the rest.
 */

export const Format = z
  .object({
    format_id: z.string(),
    format_note: str,
    ext: str,
    protocol: str,
    width: num,
    height: num,
    fps: num,
    vcodec: str,
    acodec: str,
    tbr: num,
    abr: num,
    vbr: num,
    asr: num,
    audio_channels: num,
    filesize: num,
    filesize_approx: num,
    dynamic_range: str,
    language: str,
    has_drm: bool,
  })
  .transform((f) => ({
    formatId: f.format_id,
    note: f.format_note,
    ext: f.ext,
    protocol: f.protocol,
    width: f.width,
    height: f.height,
    fps: f.fps,
    /** null when yt-dlp does not know; "none" when the format has no video. */
    vcodec: f.vcodec,
    acodec: f.acodec,
    tbr: f.tbr,
    abr: f.abr,
    vbr: f.vbr,
    sampleRate: f.asr,
    audioChannels: f.audio_channels,
    filesize: f.filesize ?? f.filesize_approx,
    filesizeIsApprox: f.filesize === null && f.filesize_approx !== null,
    dynamicRange: f.dynamic_range,
    language: f.language,
    hasDrm: f.has_drm ?? false,
  }));
export type Format = z.output<typeof Format>;

export const Thumbnail = z
  .object({ url: z.string(), id: str, width: num, height: num, preference: num })
  .transform((t) => ({
    url: t.url,
    id: t.id,
    width: t.width,
    height: t.height,
    preference: t.preference,
  }));
export type Thumbnail = z.output<typeof Thumbnail>;

export const Chapter = z
  .object({ start_time: z.number(), end_time: num, title: str })
  .transform((c) => ({ startTime: c.start_time, endTime: c.end_time, title: c.title }));
export type Chapter = z.output<typeof Chapter>;

export const SubtitleTrack = z
  .object({ ext: str, url: str, name: str })
  .transform((s) => ({ ext: s.ext, url: s.url, name: s.name }));
export type SubtitleTrack = z.output<typeof SubtitleTrack>;

/** The fields a video and a playlist share. */
const common = {
  id: z.string(),
  title: str,
  webpage_url: str,
  original_url: str,
  extractor: str,
  extractor_key: str,
  uploader: str,
  uploader_id: str,
  uploader_url: str,
  channel: str,
  channel_id: str,
  channel_url: str,
  description: str,
  thumbnails: list(Thumbnail),
  thumbnail: str,
};

type CommonRaw = z.output<z.ZodObject<typeof common>>;

function commonFields(raw: CommonRaw) {
  return {
    id: raw.id,
    title: raw.title,
    url: raw.webpage_url ?? raw.original_url,
    extractor: raw.extractor,
    extractorKey: raw.extractor_key,
    uploader: raw.uploader,
    uploaderId: raw.uploader_id,
    uploaderUrl: raw.uploader_url,
    channel: raw.channel,
    channelId: raw.channel_id,
    channelUrl: raw.channel_url,
    description: raw.description,
    thumbnails: raw.thumbnails,
    thumbnail: raw.thumbnail ?? raw.thumbnails.at(-1)?.url ?? null,
  };
}

export const VideoInfo = z
  .object({
    ...common,
    duration: num,
    timestamp: num,
    upload_date: str,
    release_timestamp: num,
    live_status: str,
    availability: str,
    age_limit: num,
    view_count: num,
    like_count: num,
    ext: str,
    format_id: str,
    width: num,
    height: num,
    formats: list(Format),
    chapters: list(Chapter),
    subtitles: listRecord(SubtitleTrack),
    automatic_captions: listRecord(SubtitleTrack),
    playlist_id: str,
    playlist_index: num,
  })
  .transform((raw) => ({
    kind: "video" as const,
    ...commonFields(raw),
    duration: raw.duration,
    timestamp: raw.timestamp ?? raw.release_timestamp,
    /** YYYYMMDD, as yt-dlp reports it. */
    uploadDate: raw.upload_date,
    liveStatus: raw.live_status,
    availability: raw.availability,
    ageLimit: raw.age_limit,
    viewCount: raw.view_count,
    likeCount: raw.like_count,
    /** The selected format, when yt-dlp chose one (it does in `--dump-single-json`). */
    ext: raw.ext,
    formatId: raw.format_id,
    width: raw.width,
    height: raw.height,
    formats: raw.formats,
    chapters: raw.chapters,
    subtitles: raw.subtitles,
    automaticCaptions: raw.automatic_captions,
    playlistId: raw.playlist_id,
    playlistIndex: raw.playlist_index,
  }));
export type VideoInfo = z.output<typeof VideoInfo>;

/**
 * One entry of a playlist or channel. Under `--flat-playlist` it is a stub (`_type: "url"`) with
 * whatever the listing page showed; otherwise it is a full video, of which this keeps the summary.
 */
export const PlaylistEntry = z
  .object({
    id: z.string(),
    _type: str,
    ie_key: str,
    url: str,
    webpage_url: str,
    title: str,
    duration: num,
    uploader: str,
    channel: str,
    channel_id: str,
    live_status: str,
    availability: str,
    timestamp: num,
    thumbnails: list(Thumbnail),
  })
  .transform((e) => ({
    id: e.id,
    /** "video" for a full entry or a video stub, "playlist" for a nested playlist (a channel tab). */
    kind: entryKind(e._type, e.ie_key, e.url),
    url: e.webpage_url ?? e.url,
    extractorKey: e.ie_key,
    title: e.title,
    duration: e.duration,
    uploader: e.uploader,
    channel: e.channel,
    channelId: e.channel_id,
    liveStatus: e.live_status,
    availability: e.availability,
    timestamp: e.timestamp,
    thumbnails: e.thumbnails,
  }));
export type PlaylistEntry = z.output<typeof PlaylistEntry>;

function entryKind(type: string | null, ieKey: string | null, url: string | null) {
  if (type === "playlist") return "playlist" as const;
  if (ieKey !== null && /tab|playlist/i.test(ieKey)) return "playlist" as const;
  if (url !== null && /[?&]list=|\/playlist\b|\/(?:videos|shorts|streams)\/?$/.test(url)) {
    return "playlist" as const;
  }
  return "video" as const;
}

export const PlaylistInfo = z
  .object({
    ...common,
    playlist_count: num,
    modified_date: str,
    entries: list(PlaylistEntry),
  })
  .transform((raw) => ({
    /**
     * "channel" when the listing is a channel's own (its id is the channel id, as for a YouTube
     * channel's videos tab), otherwise "playlist".
     */
    kind:
      raw.channel_id !== null && raw.id === raw.channel_id
        ? ("channel" as const)
        : ("playlist" as const),
    ...commonFields(raw),
    /** The count the site reports, which can exceed `entries.length` under `--playlist-end`. */
    entryCount: raw.playlist_count,
    modifiedDate: raw.modified_date,
    entries: raw.entries,
  }));
export type PlaylistInfo = z.output<typeof PlaylistInfo>;

export type ProbeResult = VideoInfo | PlaylistInfo;

/** yt-dlp's `_type`: a playlist (or channel) when "playlist" or "multi_video", else a video. */
const TypeTag = z.object({ _type: str });

/** Validates a parsed info document and types it by its `_type`. */
export function parseInfo(json: unknown): ProbeResult {
  const type = TypeTag.catch({ _type: null }).parse(json)._type;
  return type === "playlist" || type === "multi_video"
    ? PlaylistInfo.parse(json)
    : VideoInfo.parse(json);
}
