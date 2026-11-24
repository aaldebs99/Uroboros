import { afterEach, describe, expect, it } from "vitest";
import { FakeRun } from "./testFake.ts";
import { checkEncoder } from "./encoderCheck.ts";

const runs: FakeRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((r) => r.close()));
});

describe("checkEncoder", () => {
  it("encodes a second of test video with the pipeline's upload, scaler and encoder", async () => {
    const run = await FakeRun.create({ steps: [] });
    runs.push(run);
    expect(
      await checkEncoder({ ...run.options, pipeline: "vaapi", vaapiDevice: "/dev/dri/renderD129" }),
    ).toEqual({
      ok: true,
    });
    const argv = await run.argv();
    expect(argv).toEqual(
      expect.arrayContaining(["-init_hw_device", "vaapi=va:/dev/dri/renderD129", "h264_vaapi"]),
    );
    expect(argv[argv.indexOf("-vf") + 1]).toBe(
      "format=nv12,hwupload,scale_vaapi=w=640:h=360:format=nv12",
    );
    expect(argv.slice(-3)).toEqual(["-f", "null", "-"]);
  });

  it("tries NVENC through CUDA", async () => {
    const run = await FakeRun.create({ steps: [] });
    runs.push(run);
    await checkEncoder({ ...run.options, pipeline: "nvenc", vaapiDevice: "/dev/dri/renderD128" });
    const argv = await run.argv();
    expect(argv).toEqual(expect.arrayContaining(["-init_hw_device", "cuda=cu", "h264_nvenc"]));
    expect(argv[argv.indexOf("-vf") + 1]).toBe(
      "format=yuv420p,hwupload_cuda,scale_cuda=w=640:h=360",
    );
  });

  it("says why a GPU can't encode", async () => {
    const run = await FakeRun.create({
      steps: [
        {
          stderr:
            "[AVHWDeviceContext @ 0x1] No VA display found for device /dev/dri/renderD128.\nFailed to set value 'vaapi=va:/dev/dri/renderD128' for option 'init_hw_device': Invalid argument\n",
        },
      ],
      exitCode: 1,
    });
    runs.push(run);
    expect(
      await checkEncoder({ ...run.options, pipeline: "vaapi", vaapiDevice: "/dev/dri/renderD128" }),
    ).toEqual({
      ok: false,
      error:
        "Failed to set value 'vaapi=va:/dev/dri/renderD128' for option 'init_hw_device': Invalid argument",
    });
  });
});
