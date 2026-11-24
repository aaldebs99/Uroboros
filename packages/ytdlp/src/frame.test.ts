import { afterEach, describe, expect, it } from "vitest";
import { YtDlpError } from "./errors.ts";
import { grabFrame } from "./frame.ts";
import { FakeRun } from "./testFake.ts";

const runs: FakeRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((r) => r.close()));
});

const JPEG = Buffer.from("ffd8ffe000104a46494600010101", "hex");

async function fake(scenario: Parameters<typeof FakeRun.create>[0]) {
  const run = await FakeRun.create(scenario);
  runs.push(run);
  return run;
}

describe("grabFrame", () => {
  it("returns ffmpeg's JPEG, taken where asked and no wider than 1280", async () => {
    const run = await fake({ steps: [{ stdoutBase64: JPEG.toString("base64") }] });
    const bytes = await grabFrame("/media/clip.mp4", { ...run.options, atSeconds: 12.5 });
    expect(Buffer.compare(bytes, JPEG)).toBe(0);
    const argv = await run.argv();
    expect(argv.slice(argv.indexOf("-ss"), argv.indexOf("-ss") + 2)).toEqual(["-ss", "12.500"]);
    expect(argv).toContain("scale='min(1280,iw)':-2");
    expect(argv.at(-1)).toBe("pipe:1");
  });

  it("reads a URL through network protocols only", async () => {
    const run = await fake({ steps: [{ stdoutBase64: JPEG.toString("base64") }] });
    await grabFrame("https://s3.example/b/k?sig=1", { ...run.options, atSeconds: 0 });
    const argv = await run.argv();
    expect(argv).toContain("-protocol_whitelist");
    expect(argv[argv.indexOf("-i") + 1]).toBe("https://s3.example/b/k?sig=1");
  });

  it("pins the demuxers it may use, when asked", async () => {
    const run = await fake({ steps: [{ stdoutBase64: JPEG.toString("base64") }] });
    await grabFrame("/media/upload.mp4", { ...run.options, atSeconds: 0, formats: "mov,avi" });
    const argv = await run.argv();
    expect(argv[argv.indexOf("-format_whitelist") + 1]).toBe("mov,avi");
    expect(argv[argv.indexOf("-protocol_whitelist") + 1]).toBe("file");
    expect(argv.indexOf("-format_whitelist")).toBeLessThan(argv.indexOf("-i"));
  });

  it("fails when ffmpeg takes no frame, or one too large", async () => {
    const failed = await fake({ steps: [{ stderr: "Invalid data found\n" }], exitCode: 1 });
    await expect(grabFrame("/m.mp4", { ...failed.options, atSeconds: 0 })).rejects.toThrow(
      /Invalid data found/,
    );
    const empty = await fake({ steps: [] });
    await expect(grabFrame("/m.mp4", { ...empty.options, atSeconds: 0 })).rejects.toBeInstanceOf(
      YtDlpError,
    );
    const big = await fake({ steps: [{ stdoutBase64: Buffer.alloc(64).toString("base64") }] });
    await expect(
      grabFrame("/m.mp4", { ...big.options, atSeconds: 0, maxBytes: 16 }),
    ).rejects.toThrow(/too large/);
  });
});
