import { afterEach, describe, expect, it } from "vitest";
import { FakeRun } from "./testFake.ts";
import { probeKeyframes } from "./keyframes.ts";

const runs: FakeRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((r) => r.close()));
});

describe("probeKeyframes", () => {
  it("lists the video's keyframe times from its packets, sorted, from the file's start", async () => {
    const run = await FakeRun.create({
      steps: [
        {
          stdout: "1.400000,K__\n1.441667,___\n6.400000,K_\n3.900000,K__\nN/A,K__\n6.400000,K__\n",
        },
      ],
    });
    runs.push(run);
    expect(
      await probeKeyframes("/m/a.mkv", { ...run.options, streamIndex: 0, startTime: 1.4 }),
    ).toEqual([0, 2.5, 5]);
    expect(await run.argv()).toEqual([
      "-v",
      "error",
      "-select_streams",
      "0",
      "-show_entries",
      "packet=pts_time,flags",
      "-of",
      "csv=p=0",
      "-i",
      "/m/a.mkv",
    ]);
  });

  it("throws ffprobe's failure", async () => {
    const run = await FakeRun.create({
      steps: [{ stderr: "/m/a.mkv: Invalid data\n" }],
      exitCode: 1,
    });
    runs.push(run);
    await expect(probeKeyframes("/m/a.mkv", { ...run.options, streamIndex: 0 })).rejects.toThrow();
  });
});
