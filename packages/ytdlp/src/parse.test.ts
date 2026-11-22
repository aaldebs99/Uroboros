import { describe, expect, it } from "vitest";
import { parseInfo, PlaylistInfo, VideoInfo } from "./info.ts";
import { LineSplitter } from "./lines.ts";
import { MARKER, parseMarkedLine, type MarkedLine, type ProgressEvent } from "./progress.ts";
import { fixture } from "./testFake.ts";

async function json(name: string): Promise<unknown> {
  return JSON.parse(await fixture(name));
}

describe("parseInfo on recorded yt-dlp output", () => {
  it("types a video with its formats, thumbnails and uploader", async () => {
    const info = parseInfo(await json("probe-video.json"));
    if (info.kind !== "video") throw new Error(`expected a video, got ${info.kind}`);
    expect(info).toMatchObject({
      id: "aqz-KE-bpKQ",
      duration: 635,
      channelId: "UCSMOQeBJ2RAnuFungnQOxLg",
      uploaderId: "@BlenderOfficial",
      extractorKey: "Youtube",
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    });
    expect(info.formats.map((f) => f.formatId)).toContain("401");
    expect(info.formats.find((f) => f.formatId === "401")).toMatchObject({
      height: 2160,
      fps: 60,
      acodec: "none",
      ext: "mp4",
    });
    expect(info.thumbnails.length).toBeGreaterThan(0);
    expect(info.thumbnail).toMatch(/^https:\/\/i\.ytimg\.com\//);
    expect(info.chapters).toEqual([]);
  });

  it("types a flat playlist and its stub entries", async () => {
    const info = parseInfo(await json("probe-playlist.json"));
    expect(info.kind).toBe("playlist");
    if (info.kind === "video") return;
    expect(info.id).toBe("PLa1F2ddGya_8NhFM-rx_xh5SlIGbHyrZZ");
    expect(info.channelId).toBe("UCSMOQeBJ2RAnuFungnQOxLg");
    expect(info.entries).toHaveLength(1);
    expect(info.entries[0]).toMatchObject({ id: "bLojKyJx7fA", kind: "video" });
  });

  it("recognises a channel's own listing", async () => {
    const info = parseInfo(await json("probe-channel.json"));
    expect(info.kind).toBe("channel");
    if (info.kind === "video") return;
    expect(info.entries.map((e) => e.id)).toEqual(["pvUy69I_Xuk", "mHrHLqQj7Ts", "dVrELpmfcEQ"]);
    expect(info.entries[0]?.duration).toBe(1681);
  });
});

describe("lenient validation", () => {
  it("keeps going through wrong types, unknown fields and broken list items", () => {
    const info = VideoInfo.parse({
      id: "x",
      title: 42,
      duration: "long",
      brand_new_field: { nested: true },
      formats: [
        { format_id: "18", height: 360, vcodec: "avc1", unknown: 1 },
        { height: 720 },
        null,
        "garbage",
      ],
      chapters: [{ start_time: 0, end_time: 10, title: "Intro" }, { title: "no start" }],
      subtitles: { en: [{ ext: "vtt", url: "https://x/en.vtt" }, 5], de: "nope", fr: [] },
      thumbnails: "not a list",
    });
    expect(info.title).toBeNull();
    expect(info.duration).toBeNull();
    expect(info.formats).toHaveLength(1);
    expect(info.formats[0]).toMatchObject({ formatId: "18", height: 360, width: null });
    expect(info.chapters).toEqual([{ startTime: 0, endTime: 10, title: "Intro" }]);
    expect(info.subtitles).toEqual({ en: [{ ext: "vtt", url: "https://x/en.vtt", name: null }] });
    expect(info.thumbnails).toEqual([]);
    expect(info).not.toHaveProperty("brand_new_field");
  });

  it("drops null playlist entries (unavailable videos) rather than failing", () => {
    const info = PlaylistInfo.parse({
      _type: "playlist",
      id: "PL1",
      entries: [null, { id: "a", _type: "url", url: "https://www.youtube.com/watch?v=a" }],
    });
    expect(info.entries.map((e) => e.id)).toEqual(["a"]);
  });

  it("marks nested playlists (channel tabs) as playlist entries", () => {
    const info = PlaylistInfo.parse({
      _type: "playlist",
      id: "UC1",
      channel_id: "UC1",
      entries: [
        { id: "UC1", _type: "url", ie_key: "YoutubeTab", url: "https://www.youtube.com/@x/videos" },
      ],
    });
    expect(info.kind).toBe("channel");
    expect(info.entries[0]?.kind).toBe("playlist");
  });

  it("still requires an id", () => {
    expect(() => parseInfo({ title: "no id" })).toThrow();
  });
});

interface Transcript {
  stdout: string;
  stderr: string;
}

function marked(text: string): MarkedLine[] {
  return text
    .split("\n")
    .map(parseMarkedLine)
    .filter((line) => line !== null);
}

describe("progress lines", () => {
  it("parses a recorded download, from the first bytes to the finished file", async () => {
    const transcript = (await json("download-clip.json")) as Transcript;
    const lines = [...marked(transcript.stdout), ...marked(transcript.stderr)];
    const events = lines.flatMap((l) => (l.type === "progress" ? [l.event] : []));
    const files = lines.flatMap((l) => (l.type === "file" ? [l.file] : []));
    expect(events[0]).toMatchObject({
      phase: "downloading",
      state: "running",
      videoId: "clip",
      downloadedBytes: 1024,
      totalBytes: 46154,
      totalIsEstimate: false,
      speed: null,
    });
    const finished = events.find((e) => e.phase === "downloading" && e.state === "finished");
    expect(finished?.downloadedBytes).toBe(46154);
    expect(finished?.speed).toBeGreaterThan(0);
    expect(events.filter((e) => e.phase === "postprocessing").map((e) => e.state)).toEqual([
      "started",
      "finished",
    ]);
    expect(files).toEqual([
      { videoId: "clip", path: "{{cwd}}/clip.mp4", infoJsonPath: "{{cwd}}/clip.info.json" },
    ]);
  });

  it("reads fragments, estimates, NA values and the merger", () => {
    const fragment = parseMarkedLine(
      `${MARKER}\tdownload\t"vid"\t{"status": "downloading", "downloaded_bytes": 500, "total_bytes_estimate": 9000, "eta": "NA", "fragment_index": 3, "fragment_count": 12}`,
    );
    expect(fragment).toMatchObject({
      type: "progress",
      event: {
        totalBytes: 9000,
        totalIsEstimate: true,
        eta: null,
        fragmentIndex: 3,
        fragmentCount: 12,
      } satisfies Partial<ProgressEvent>,
    });
    const merge = parseMarkedLine(
      `${MARKER}\tpostprocess\t"NA"\t{"status": "processing", "postprocessor": "Merger"}`,
    );
    expect(merge).toMatchObject({
      event: { phase: "merging", state: "running", videoId: null, postprocessor: "Merger" },
    });
  });

  it("ignores ordinary output and malformed marked lines", () => {
    for (const line of [
      "[download] Destination: clip.mp4",
      `${MARKER}\tdownload\t"x"\tnot json`,
      `${MARKER}\tdownload\t"x"\t[1,2]`,
      `${MARKER}\tfile\t"x"\t42\t"x.info.json"`,
      `${MARKER}\tsomething\t"x"\t{}`,
      MARKER,
    ]) {
      expect(parseMarkedLine(line)).toBeNull();
    }
  });

  it("survives a progress line split across chunks at any byte", async () => {
    const transcript = (await json("download-clip.json")) as Transcript;
    const expected = marked(transcript.stdout);
    for (const size of [1, 7, 64, 1000]) {
      const splitter = new LineSplitter();
      const got: MarkedLine[] = [];
      for (let i = 0; i < transcript.stdout.length; i += size) {
        for (const line of splitter.push(transcript.stdout.slice(i, i + size))) {
          const parsed = parseMarkedLine(line);
          if (parsed !== null) got.push(parsed);
        }
      }
      splitter.flush();
      expect(got).toEqual(expected);
    }
  });
});
