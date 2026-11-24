import type { Pipeline, RunPlan } from "@uroboros/ytdlp";
import type { StoredPlan } from "./sessions.ts";

/** What a run needs to know of the source's streams (ffprobe's, cover art excluded). */
export interface SourceStreams {
  video: { index: number; codec: string | null; pixFmt: string | null } | null;
  audio: { index: number } | null;
  /** The video's transfer when it is HDR. */
  hdr: "smpte2084" | "arib-std-b67" | null;
}

export interface RunPlanInput {
  input: string;
  plan: StoredPlan;
  streams: SourceStreams;
  boundaries: readonly number[];
  /** The segment the run starts at. */
  first: number;
  pipeline: Pipeline;
  vaapiDevice: string;
}

/** One run of a session, from its plan (docs/transcoding.md). */
export function runPlanFor(o: RunPlanInput): RunPlan {
  const { plan, streams } = o;
  const v = streams.video;
  let video: RunPlan["video"] = null;
  if (plan.mode !== "audio" && v !== null) {
    video =
      plan.mode === "remux"
        ? { index: v.index, copy: true, hevc: v.codec === "hevc" }
        : {
            index: v.index,
            copy: false,
            pipeline: o.pipeline,
            width: plan.width ?? 0,
            height: plan.height ?? 0,
            bitrate: plan.bitrate ?? 0,
            level: plan.level ?? 0,
            hdr: streams.hdr,
          };
  }
  return {
    input: o.input,
    start: o.boundaries[o.first] ?? 0,
    mode: plan.mode,
    video,
    audio:
      plan.audio === null || streams.audio === null
        ? null
        : { index: streams.audio.index, copy: plan.audio === "copy" },
    vaapiDevice: o.vaapiDevice,
  };
}
