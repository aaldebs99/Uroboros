/**
 * The video half of a playback session's ffmpeg command (docs/transcoding.md): how frames are
 * decoded, scaled, tone-mapped and encoded on each pipeline. A `-sw` pipeline decodes on the CPU
 * and uploads to the GPU, for sources the GPU can't decode (10-bit H.264, say).
 */

export type Pipeline = "cpu" | "nvenc" | "nvenc-sw" | "vaapi" | "vaapi-sw";

export interface EncodeSettings {
  pipeline: Pipeline;
  width: number;
  height: number;
  /** Bits per second, the cap of the quality's rung. */
  bitrate: number;
  /** The H.264 level ×10 (42 is 4.2), matching the playlist's codec string. */
  level: number;
  /** The source's transfer when it is HDR (PQ or HLG), which is tone-mapped to BT.709. */
  hdr: "smpte2084" | "arib-std-b67" | null;
}

const TONEMAP = "tonemap=bt2390:desat=0:peak=100:t=bt709:m=bt709:p=bt709";
/** Keyframes on every 6 s boundary, counted from the run's start (always a boundary). */
export const FORCE_KEYFRAMES = "expr:gte(t,n_forced*6)";

/** Input options before the video's `-i`: device setup and hardware decoding. */
export function videoInputArgs(pipeline: Pipeline, vaapiDevice: string): string[] {
  const vaapi = ["-init_hw_device", `vaapi=va:${vaapiDevice}`, "-filter_hw_device", "va"];
  switch (pipeline) {
    case "cpu":
      return [];
    case "nvenc":
      return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"];
    case "nvenc-sw":
      return ["-init_hw_device", "cuda=cu", "-filter_hw_device", "cu"];
    case "vaapi":
      return [
        ...vaapi,
        "-hwaccel",
        "vaapi",
        "-hwaccel_device",
        "va",
        "-hwaccel_output_format",
        "vaapi",
      ];
    case "vaapi-sw":
      return vaapi;
  }
}

/** The filter graph. Scaling comes first, so tone-mapping works on the smaller frames. */
export function videoFilter(e: EncodeSettings): string {
  const { width: w, height: h } = e;
  const cpuScale = `scale=${String(w)}:${String(h)}`;
  const tonemap = (format: string) => `tonemapx=${TONEMAP}:format=${format}`;
  switch (e.pipeline) {
    case "cpu":
      return `${cpuScale},${e.hdr ? tonemap("yuv420p") : "format=yuv420p"}`;
    case "nvenc-sw":
      return `${cpuScale},${e.hdr ? tonemap("yuv420p") : "format=yuv420p"},hwupload_cuda`;
    case "vaapi-sw":
      return `${cpuScale},${e.hdr ? tonemap("nv12") : "format=nv12"},hwupload`;
    case "nvenc":
      // scale_cuda drops the colour properties tonemap_cuda needs, so they are set again first.
      return e.hdr
        ? `setparams=color_primaries=bt2020:color_trc=${e.hdr}:colorspace=bt2020nc,` +
            `scale_cuda=w=${String(w)}:h=${String(h)},tonemap_cuda=${TONEMAP}:format=yuv420p`
        : `scale_cuda=w=${String(w)}:h=${String(h)}:format=yuv420p`;
    case "vaapi":
      return e.hdr
        ? `scale_vaapi=w=${String(w)}:h=${String(h)}:format=p010,hwdownload,format=p010le,` +
            `${tonemap("nv12")},hwupload`
        : `scale_vaapi=w=${String(w)}:h=${String(h)}:format=nv12`;
  }
}

/** The encoder and its rate control: the rung's cap, and the level the playlist names. */
export function videoEncoderArgs(e: EncodeSettings): string[] {
  const rate = String(e.bitrate);
  const buffer = String(e.bitrate * 2);
  const profile = ["-profile:v", "high", "-level:v", (e.level / 10).toFixed(1)];
  switch (e.pipeline) {
    case "cpu":
      return [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-maxrate",
        rate,
        "-bufsize",
        buffer,
        ...profile,
        "-sc_threshold",
        "0",
      ];
    case "nvenc":
    case "nvenc-sw":
      return [
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-b:v",
        rate,
        "-maxrate",
        rate,
        "-bufsize",
        buffer,
        ...profile,
        "-forced-idr",
        "1",
      ];
    case "vaapi":
    case "vaapi-sw":
      return [
        "-c:v",
        "h264_vaapi",
        "-rc_mode",
        "VBR",
        "-b:v",
        rate,
        "-maxrate",
        rate,
        "-bufsize",
        buffer,
        ...profile,
      ];
  }
}
