import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { download } from "./download.ts";
import { YtDlpError } from "./errors.ts";
import type { PickedSize, ProgressEvent } from "./progress.ts";
import {
  FakeRun,
  fixture,
  readWhenWritten,
  type Scenario,
  type Step,
  waitDead,
} from "./testFake.ts";

const runs: FakeRun[] = [];

async function fake(scenario: Scenario): Promise<FakeRun> {
  const run = await FakeRun.create(scenario);
  runs.push(run);
  return run;
}

afterEach(async () => {
  await Promise.all(runs.splice(0).map((run) => run.close()));
});

async function failure(promise: Promise<unknown>): Promise<YtDlpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof YtDlpError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

const URL = "http://127.0.0.1:18765/clip.mp4";

/** Replays the recorded download, its stdout cut into `chunk`-sized writes. */
async function recordedSteps(chunk: number): Promise<Step[]> {
  const transcript = JSON.parse(await fixture("download-clip.json")) as {
    stdout: string;
    stderr: string;
  };
  const stdout: Step[] = [];
  for (let i = 0; i < transcript.stdout.length; i += chunk) {
    stdout.push({ stdout: transcript.stdout.slice(i, i + chunk) }, { sleepMs: 1 });
  }
  return [
    { writeFile: "clip.mp4", content: "media" },
    { writeFile: "clip.info.json", content: await fixture("info-clip.json") },
    ...stdout,
    { stderr: "WARNING: a harmless warning\n" },
    { stderr: transcript.stderr },
  ];
}

describe("download", () => {
  it("reports progress through partial lines and resolves with the files and info.json", async () => {
    const run = await fake({ steps: await recordedSteps(37) });
    const events: ProgressEvent[] = [];
    const result = await download(URL, {
      ...run.options,
      workDir: run.workDir,
      format: "bv*[height<=1080]+ba/b",
      outputTemplate: "%(id)s.%(ext)s",
      onProgress: (event) => events.push(event),
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      videoId: "clip",
      path: join(run.workDir, "clip.mp4"),
      infoJsonPath: join(run.workDir, "clip.info.json"),
      info: { kind: "video", id: "clip", ext: "mp4" },
    });
    expect(events.filter((e) => e.phase === "downloading")).toHaveLength(7);
    expect(events.at(-1)).toMatchObject({ phase: "postprocessing", state: "finished" });
    expect(result.stderrTail).toEqual(["WARNING: a harmless warning"]);

    const argv = await run.argv();
    expect(argv.slice(-2)).toEqual(["--", URL]);
    for (const [flag, value] of [
      ["--format", "bv*[height<=1080]+ba/b"],
      ["--output", "%(id)s.%(ext)s"],
      ["--paths", run.workDir],
    ]) {
      expect(argv[argv.indexOf(flag as string) + 1]).toBe(value);
    }
    expect(argv).toContain("--write-info-json");
    expect(argv).toContain("--newline");
  });

  it("tells the size of what yt-dlp picked before it downloads, and asks yt-dlp to say it", async () => {
    const run = await fake({
      steps: [
        { stdout: `[uroboros]\tsize\t"clip"\t722647490\n` },
        { writeFile: "clip.mp4", content: "media" },
        { writeFile: "clip.info.json", content: await fixture("info-clip.json") },
        { stdout: `[uroboros]\tfile\t"clip"\t"{{cwd}}/clip.mp4"\t"clip.info.json"\n` },
      ],
    });
    const sizes: PickedSize[] = [];
    const result = await download(URL, {
      ...run.options,
      workDir: run.workDir,
      format: "b",
      onSize: (size) => sizes.push(size),
    });
    expect(sizes).toEqual([{ videoId: "clip", bytes: 722647490 }]);
    expect(result.files).toHaveLength(1);
    const argv = await run.argv();
    expect(argv).toContain("before_dl:[uroboros]\tsize\t%(id)j\t%(filesize,filesize_approx)j");
  });

  it("rethrows a progress callback's error once the run is over", async () => {
    const run = await fake({ steps: await recordedSteps(4096) });
    const boom = new Error("callback broke");
    await expect(
      download(URL, {
        ...run.options,
        workDir: run.workDir,
        format: "b",
        onProgress: () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);
  });

  it("fails as invalid_output when the .info.json is missing", async () => {
    const run = await fake({
      steps: [{ stdout: `[uroboros]\tfile\t"x"\t"{{cwd}}/x.mp4"\t"{{cwd}}/x.info.json"\n` }],
    });
    const error = await failure(
      download(URL, { ...run.options, workDir: run.workDir, format: "b" }),
    );
    expect(error.kind).toBe("invalid_output");
  });

  it("refuses a finished file or .info.json outside the job's folder", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "uro-elsewhere-"));
    try {
      await writeFile(join(elsewhere, "x.info.json"), await fixture("probe-video.json"));
      for (const [file, info] of [
        ["/etc/hostname", "{{cwd}}/x.info.json"],
        ["{{cwd}}/x.mp4", join(elsewhere, "x.info.json")],
        ["{{cwd}}/../x.mp4", "{{cwd}}/x.info.json"],
      ]) {
        const run = await fake({
          steps: [
            { stdout: `[uroboros]\tfile\t"x"\t${JSON.stringify(file)}\t${JSON.stringify(info)}\n` },
          ],
        });
        await writeFile(join(run.workDir, "x.info.json"), await fixture("probe-video.json"));
        const error = await failure(
          download(URL, { ...run.options, workDir: run.workDir, format: "b" }),
        );
        expect(error.kind, file).toBe("invalid_output");
        expect(error.message, file).toMatch(/outside the job's folder/);
      }
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("classifies a failed download", async () => {
    const run = await fake({
      steps: [{ stderr: "ERROR: [youtube] abc: Video unavailable. This video is private\n" }],
      exitCode: 1,
    });
    const error = await failure(
      download(URL, { ...run.options, workDir: run.workDir, format: "b" }),
    );
    expect(error.kind).toBe("private");
  });

  it("requires an absolute work dir", async () => {
    const error = await failure(download(URL, { workDir: "relative", format: "b" }));
    expect(error.kind).toBe("invalid_arguments");
  });
});

describe("cancellation", () => {
  async function cancelMidDownload(ignoreSigterm: boolean) {
    const run = await fake({
      pidFile: "yt-dlp.pid",
      ignoreSigterm,
      steps: [
        { writeFile: "clip.mp4.part", content: "partial" },
        { writeFile: "clip.f137.mp4.part-Frag3", content: "fragment" },
        { writeFile: "clip.mp4.ytdl", content: "{}" },
        { writeFile: "keep.info.json", content: "{}" },
        { spawnSleeper: "ffmpeg.pid" },
        {
          stdout: `[uroboros]\tdownload\t"clip"\t{"status": "downloading", "downloaded_bytes": 7}\n`,
        },
        { hang: true },
      ],
    });
    const controller = new AbortController();
    const events: ProgressEvent[] = [];
    let abortedAt = 0;
    const pending = download(URL, {
      ...run.options,
      workDir: run.workDir,
      format: "b",
      signal: controller.signal,
      killGraceMs: 300,
      onProgress: (event) => {
        events.push(event);
        abortedAt = Date.now();
        controller.abort();
      },
    });
    const error = await failure(pending);
    const tookMs = Date.now() - abortedAt;
    const ytdlp = Number(await readWhenWritten(join(run.workDir, "yt-dlp.pid")));
    const ffmpeg = Number(await readWhenWritten(join(run.workDir, "ffmpeg.pid")));
    return { run, error, events, ytdlp, ffmpeg, tookMs };
  }

  it("kills the process group and removes the partial files", async () => {
    const { run, error, events, ytdlp, ffmpeg } = await cancelMidDownload(false);
    expect(error.kind).toBe("cancelled");
    expect(events).toHaveLength(1);
    expect(await waitDead(ytdlp)).toBe(true);
    expect(await waitDead(ffmpeg)).toBe(true);
    expect((await readdir(run.workDir)).sort()).toEqual([
      "ffmpeg.pid",
      "keep.info.json",
      "yt-dlp.pid",
    ]);
  });

  it("escalates to SIGKILL when yt-dlp ignores SIGTERM", async () => {
    const { error, ytdlp, ffmpeg, tookMs } = await cancelMidDownload(true);
    expect(error.kind).toBe("cancelled");
    // From the abort, not from before the fake's two processes started: the grace was waited out.
    expect(tookMs).toBeGreaterThanOrEqual(290);
    expect(await waitDead(ytdlp)).toBe(true);
    expect(await waitDead(ffmpeg)).toBe(true);
  });

  it("times out the same way", async () => {
    const run = await fake({
      steps: [{ writeFile: "clip.mp4.part", content: "partial" }, { hang: true }],
    });
    const error = await failure(
      download(URL, {
        ...run.options,
        workDir: run.workDir,
        format: "b",
        timeoutMs: 300,
        killGraceMs: 200,
      }),
    );
    expect(error.kind).toBe("timed_out");
    expect(await readdir(run.workDir)).toEqual([]);
  });
});
