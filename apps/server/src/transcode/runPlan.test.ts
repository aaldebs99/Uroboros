import { describe, expect, it } from "vitest";
import { runPlanFor, type SourceStreams } from "./runPlan.ts";
import type { StoredPlan } from "./sessions.ts";

const encodePlan: StoredPlan = {
  mode: "encode",
  quality: "720",
  width: 1280,
  height: 720,
  bitrate: 4_000_000,
  level: 32,
  audio: "aac",
  codecs: ["avc1.640020", "mp4a.40.2"],
  bandwidth: 4_160_000,
  boundaries: "uniform",
  reason: "picked",
  start: 0,
};
const streams: SourceStreams = {
  video: { index: 1, codec: "hevc", pixFmt: "yuv420p10le" },
  audio: { index: 2 },
  hdr: "smpte2084",
};
const boundaries = [0, 6, 12, 18, 20];

describe("runPlanFor", () => {
  it("encodes from the run's boundary with the session's size, cap, level and pipeline", () => {
    expect(
      runPlanFor({
        input: "/m/a.mkv",
        plan: encodePlan,
        streams,
        boundaries,
        first: 2,
        pipeline: "vaapi",
        vaapiDevice: "/dev/dri/renderD129",
      }),
    ).toEqual({
      input: "/m/a.mkv",
      start: 12,
      mode: "encode",
      video: {
        index: 1,
        copy: false,
        pipeline: "vaapi",
        width: 1280,
        height: 720,
        bitrate: 4_000_000,
        level: 32,
        hdr: "smpte2084",
      },
      audio: { index: 2, copy: false },
      vaapiDevice: "/dev/dri/renderD129",
    });
  });

  it("copies the video for a remux, tagging HEVC", () => {
    const plan: StoredPlan = {
      ...encodePlan,
      mode: "remux",
      bitrate: null,
      level: null,
      audio: "copy",
    };
    const run = runPlanFor({
      input: "/m/a.mkv",
      plan,
      streams,
      boundaries,
      first: 0,
      pipeline: "cpu",
      vaapiDevice: "",
    });
    expect(run.video).toEqual({ index: 1, copy: true, hevc: true });
    expect(run.audio).toEqual({ index: 2, copy: true });
    expect(run.start).toBe(0);
  });

  it("plays only the audio of an audio session, and no audio for a silent one", () => {
    const audio: StoredPlan = { ...encodePlan, mode: "audio", width: null, height: null };
    expect(
      runPlanFor({
        input: "x",
        plan: audio,
        streams,
        boundaries,
        first: 1,
        pipeline: "cpu",
        vaapiDevice: "",
      }),
    ).toMatchObject({
      mode: "audio",
      video: null,
      audio: { index: 2, copy: false },
    });
    const silent = runPlanFor({
      input: "x",
      plan: { ...encodePlan, audio: null },
      streams,
      boundaries,
      first: 0,
      pipeline: "cpu",
      vaapiDevice: "",
    });
    expect(silent.audio).toBeNull();
  });
});
