import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { FakeRun } from "@uroboros/ytdlp/testing";
import {
  choosePipeline,
  encoderOf,
  PipelineMemo,
  pipelinesFor,
  selfTest,
  sourceKey,
} from "./hwaccel.ts";

describe("pipelinesFor", () => {
  it("tries the whole GPU, then GPU encoding after a CPU decode, then the CPU", () => {
    expect(pipelinesFor("nvenc", true)).toEqual(["nvenc", "nvenc-sw", "cpu"]);
    expect(pipelinesFor("vaapi", true)).toEqual(["vaapi", "vaapi-sw", "cpu"]);
    expect(pipelinesFor("none", true)).toEqual(["cpu"]);
  });

  it("uses only the CPU when the GPU failed its startup test", () => {
    expect(pipelinesFor("nvenc", false)).toEqual(["cpu"]);
  });
});

describe("choosePipeline", () => {
  const h264hi10 = sourceKey({ codec: "h264", pixFmt: "yuv420p10le" });
  const h264 = sourceKey({ codec: "h264", pixFmt: "yuv420p" });

  it("skips a pipeline that already failed on this kind of source, on this replica", () => {
    const memo = new PipelineMemo();
    const chain = pipelinesFor("vaapi", true);
    expect(choosePipeline(chain, memo, h264hi10)).toBe("vaapi");
    memo.markFailed("vaapi", h264hi10);
    expect(choosePipeline(chain, memo, h264hi10)).toBe("vaapi-sw");
    expect(choosePipeline(chain, memo, h264)).toBe("vaapi");
    memo.markFailed("vaapi-sw", h264hi10);
    expect(choosePipeline(chain, memo, h264hi10)).toBe("cpu");
  });

  it("never gives up on the CPU", () => {
    const memo = new PipelineMemo();
    memo.markFailed("cpu", h264);
    expect(choosePipeline(["cpu"], memo, h264)).toBe("cpu");
  });

  it("names the encoder each pipeline uses", () => {
    expect(encoderOf("nvenc-sw")).toBe("nvenc");
    expect(encoderOf("vaapi")).toBe("vaapi");
    expect(encoderOf("cpu")).toBe("libx264");
  });
});

describe("selfTest", () => {
  const runs: FakeRun[] = [];
  afterEach(async () => {
    await Promise.all(runs.splice(0).map((r) => r.close()));
  });
  const log = () => {
    const info = vi.fn();
    const warn = vi.fn();
    return { logger: { info, warn } as unknown as Logger, info, warn };
  };

  it("passes without a GPU to test", async () => {
    const { logger, info } = log();
    expect(
      await selfTest({ hwaccel: "none", vaapiDevice: "", ffmpeg: "/nonexistent", logger }),
    ).toBe(true);
    expect(info).toHaveBeenCalledWith({ hwaccel: "none" }, "transcoding on the CPU");
  });

  it("logs a GPU that encodes", async () => {
    const run = await FakeRun.create({ steps: [] });
    runs.push(run);
    const { logger, info } = log();
    expect(
      await selfTest({
        hwaccel: "nvenc",
        vaapiDevice: "",
        ffmpeg: run.options.binary,
        env: run.options.env,
        logger,
      }),
    ).toBe(true);
    expect(info).toHaveBeenCalledWith({ hwaccel: "nvenc" }, "transcoding on the GPU");
  });

  it("warns and falls back to the CPU when the GPU can't encode", async () => {
    const run = await FakeRun.create({
      steps: [{ stderr: "[h264_nvenc @ 0x1] Cannot load libcuda.so.1\n" }],
      exitCode: 1,
    });
    runs.push(run);
    const { logger, warn } = log();
    expect(
      await selfTest({
        hwaccel: "nvenc",
        vaapiDevice: "",
        ffmpeg: run.options.binary,
        env: run.options.env,
        logger,
      }),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      { hwaccel: "nvenc", error: "h264_nvenc: Cannot load libcuda.so.1" },
      "the GPU can't encode; transcoding on the CPU instead",
    );
  });
});
