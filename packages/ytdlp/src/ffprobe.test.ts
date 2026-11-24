import { afterEach, describe, expect, it } from "vitest";
import { ffprobe } from "./ffprobe.ts";
import { FakeRun } from "./testFake.ts";

const runs: FakeRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((r) => r.close()));
});

const json = {
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "av1",
      profile: "Main",
      level: 8,
      mime_codec_string: "av01.0.08M.10.0.110.02.02.09.0",
      width: 1920,
      height: 1080,
      pix_fmt: "yuv420p10le",
      color_transfer: "smpte2084",
      color_primaries: "bt2020",
      disposition: { default: 1, attached_pic: 0 },
    },
    { index: 1, codec_type: "audio", codec_name: "opus", level: -99, mime_codec_string: "opus" },
    {
      index: 2,
      codec_type: "video",
      codec_name: "mjpeg",
      disposition: { attached_pic: 1 },
    },
  ],
  format: { format_name: "matroska,webm", duration: "30.0", start_time: "0.007000" },
};

describe("ffprobe for playback sessions", () => {
  it("reads levels, codec strings, colour, cover art and the start time", async () => {
    const run = await FakeRun.create({ steps: [{ stdout: JSON.stringify(json) }] });
    runs.push(run);
    const info = await ffprobe("/m/a.mkv", run.options);
    expect(info.startTime).toBe(0.007);
    expect(info.streams[0]).toMatchObject({
      pixFmt: "yuv420p10le",
      colorTransfer: "smpte2084",
      level: 8,
      mimeCodec: "av01.0.08M.10.0.110.02.02.09.0",
      colorPrimaries: "bt2020",
      attachedPic: false,
    });
    expect(info.streams[1]).toMatchObject({ level: null, mimeCodec: "opus" });
    expect(info.streams[2]).toMatchObject({ attachedPic: true, mimeCodec: null });
  });

  it("takes a URL as it is, and only network protocols for it", async () => {
    const run = await FakeRun.create({ steps: [{ stdout: JSON.stringify(json) }] });
    runs.push(run);
    await ffprobe("http://rustfs:9000/media/a.mkv?sig=1", run.options);
    const argv = await run.argv();
    expect(argv.slice(-4)).toEqual([
      "-protocol_whitelist",
      "http,https,tcp,tls,crypto",
      "-i",
      "http://rustfs:9000/media/a.mkv?sig=1",
    ]);
  });
});

describe("ffprobe on a file someone uploaded", () => {
  it("pins the demuxers it may use, and a local file to the file protocol", async () => {
    const run = await FakeRun.create({ steps: [{ stdout: JSON.stringify(json) }] });
    runs.push(run);
    await ffprobe("/media/upload.mp4", { ...run.options, formats: "mov,matroska,avi" });
    const argv = await run.argv();
    expect(
      argv.slice(argv.indexOf("-format_whitelist"), argv.indexOf("-format_whitelist") + 2),
    ).toEqual(["-format_whitelist", "mov,matroska,avi"]);
    expect(argv[argv.indexOf("-protocol_whitelist") + 1]).toBe("file");
    expect(argv.indexOf("-format_whitelist")).toBeLessThan(argv.indexOf("-i"));
  });

  it("keeps a URL to the network protocols", async () => {
    const run = await FakeRun.create({ steps: [{ stdout: JSON.stringify(json) }] });
    runs.push(run);
    await ffprobe("https://s3.example/b/k", { ...run.options, formats: "mov" });
    const argv = await run.argv();
    expect(argv[argv.indexOf("-protocol_whitelist") + 1]).toBe("http,https,tcp,tls,crypto");
    expect(argv).toContain("-format_whitelist");
  });
});
