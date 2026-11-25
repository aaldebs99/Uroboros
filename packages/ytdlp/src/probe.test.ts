import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseArgs } from "./args.ts";
import { YtDlpError } from "./errors.ts";
import { ffprobe } from "./ffprobe.ts";
import { probe } from "./probe.ts";
import { FakeRun, fixture, type Scenario } from "./testFake.ts";

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

const URL = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";

describe("probe", () => {
  it("runs yt-dlp without a shell and types what it prints", async () => {
    const run = await fake({ steps: [{ stdout: await fixture("probe-video.json") }] });
    const info = await probe(URL, run.options);
    expect(info).toMatchObject({ kind: "video", id: "aqz-KE-bpKQ" });
    expect(await run.argv()).toEqual([
      ...baseArgs({ cookies: null, netrcDir: null }),
      "--dump-single-json",
      "--no-warnings",
      "--no-progress",
      "--",
      URL,
    ]);
  });

  it("adds --flat-playlist and the extra arguments", async () => {
    const run = await fake({ steps: [{ stdout: await fixture("probe-playlist.json") }] });
    const info = await probe(URL, {
      ...run.options,
      flat: true,
      extraArgs: ["--playlist-items", "1:3"],
    });
    expect(info.kind).toBe("playlist");
    const argv = await run.argv();
    expect(argv).toContain("--flat-playlist");
    expect(argv.slice(-3)).toEqual(["--playlist-items=1:3", "--", URL]);
  });

  it("classifies a recorded unavailable video and keeps its stderr", async () => {
    const recorded = JSON.parse(await fixture("probe-unavailable.json")) as {
      stderr: string;
      exitCode: number;
    };
    const run = await fake({ steps: [{ stderr: recorded.stderr }], exitCode: recorded.exitCode });
    const error = await failure(probe(URL, run.options));
    expect(error.kind).toBe("unavailable");
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe("[youtube] xxxxxxxxxxx: This video is unavailable");
    expect(error.stderrTail).toEqual(["ERROR: [youtube] xxxxxxxxxxx: This video is unavailable"]);
  });

  it("keeps only the last stderr lines, redacted", async () => {
    const noise = Array.from({ length: 30 }, (_, i) => `[debug] line ${String(i)}\n`).join("");
    const run = await fake({
      steps: [
        { stderr: noise },
        { stderr: "ERROR: HTTP Error 429 on https://x.example/a?token=s3cret\n" },
      ],
      exitCode: 1,
    });
    const error = await failure(probe(URL, { ...run.options, stderrTailLines: 3 }));
    expect(error.kind).toBe("rate_limited");
    expect(error.stderrTail).toEqual([
      "[debug] line 28",
      "[debug] line 29",
      "ERROR: HTTP Error 429 on https://x.example/a?<redacted>",
    ]);
  });

  it("rejects a non-http URL before spawning anything", async () => {
    const run = await fake({ steps: [] });
    const error = await failure(probe("file:///etc/passwd", run.options));
    expect(error.kind).toBe("invalid_url");
    await expect(run.argv()).rejects.toThrow();
  });

  it("refuses a flag outside the allowlist before spawning anything", async () => {
    const run = await fake({ steps: [] });
    const error = await failure(probe(URL, { ...run.options, extraArgs: ["--exe", "id"] }));
    expect(error.kind).toBe("invalid_arguments");
    await expect(run.argv()).rejects.toThrow();
  });

  it("fails as invalid_output on non-JSON or a non-info document", async () => {
    const notJson = await fake({ steps: [{ stdout: "hello" }] });
    expect((await failure(probe(URL, notJson.options))).kind).toBe("invalid_output");
    const noId = await fake({ steps: [{ stdout: `{"title": "no id"}` }] });
    expect((await failure(probe(URL, noId.options))).kind).toBe("invalid_output");
  });

  it("fails as spawn_failed when the binary is missing", async () => {
    const error = await failure(probe(URL, { binary: "/nonexistent/yt-dlp" }));
    expect(error.kind).toBe("spawn_failed");
  });

  it("times out", async () => {
    const run = await fake({ steps: [{ hang: true }] });
    const error = await failure(probe(URL, { ...run.options, timeoutMs: 200, killGraceMs: 200 }));
    expect(error.kind).toBe("timed_out");
  });

  it("fails as cancelled when the signal is already aborted", async () => {
    const run = await fake({ steps: [] });
    const error = await failure(probe(URL, { ...run.options, signal: AbortSignal.abort() }));
    expect(error.kind).toBe("cancelled");
  });

  it("hands yt-dlp a private copy of the cookies and removes it afterwards", async () => {
    const run = await fake({ steps: [{ stdout: await fixture("probe-video.json") }] });
    const original = join(run.dir, "cookies.txt");
    await writeFile(original, "# Netscape HTTP Cookie File\n");
    // A temp dir of this test's own: in the shared one, anything else making a
    // uroboros-cookies-* directory meanwhile would look like a leftover.
    const temp = await mkdtemp(join(tmpdir(), "uroboros-probe-tmp-"));
    vi.stubEnv("TMPDIR", temp);
    try {
      await probe(URL, { ...run.options, cookiesFile: original });
    } finally {
      vi.unstubAllEnvs();
    }
    const argv = await run.argv();
    const copy = argv[argv.indexOf("--cookies") + 1];
    expect(copy).toMatch(new RegExp(`^${temp}/uroboros-cookies-.*/cookies\\.txt$`));
    expect(copy).not.toBe(original);
    expect(await readdir(temp)).toEqual([]);
    await rm(temp, { recursive: true, force: true });
  });

  it("signs in from a private .netrc, never on the command line, and scrubs the password", async () => {
    const run = await fake({
      steps: [
        { copyArgFile: "--netrc-location", name: ".netrc", as: "netrc-seen" },
        { stderr: "[debug] login form said hunter22 was wrong\n" },
        { stderr: "ERROR: [vimeo] Unable to log in: bad username or password\n" },
      ],
      exitCode: 1,
    });
    const error = await failure(
      probe(URL, {
        ...run.options,
        logins: [{ site: "vimeo", username: "me@example.com", password: "hunter22" }],
      }),
    );
    expect(error.kind).toBe("login_failed");
    expect(error.stderrTail.join("\n")).not.toContain("hunter22");
    const argv = await run.argv();
    expect(argv).toContain("--netrc");
    expect(argv[argv.indexOf("--netrc-location") + 1]).toMatch(/uroboros-netrc-/);
    expect(argv.join(" ")).not.toContain("hunter22");
    expect(await run.copied("netrc-seen")).toBe(
      'machine vimeo login "me@example.com" password "hunter22"\n',
    );
  });

  it("passes no --netrc without logins", async () => {
    const run = await fake({ steps: [{ stdout: await fixture("probe-video.json") }] });
    await probe(URL, { ...run.options, logins: [] });
    expect(await run.argv()).not.toContain("--netrc");
  });
});

describe("ffprobe", () => {
  it("types streams, codecs, duration and container", async () => {
    const run = await fake({ steps: [{ stdout: await fixture("ffprobe-clip.json") }] });
    const media = await ffprobe("relative/clip.mp4", run.options);
    expect(media).toMatchObject({
      container: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: 3,
      size: 46154,
    });
    expect(media.streams).toEqual([
      expect.objectContaining({ type: "video", codec: "h264", width: 320, height: 240, fps: 25 }),
      expect.objectContaining({ type: "audio", codec: "aac", sampleRate: 44100, channels: 1 }),
    ]);
    const argv = await run.argv();
    expect(argv.at(-1)).toMatch(/^\/.*\/relative\/clip\.mp4$/);
  });

  it("fails on ffprobe's error exit", async () => {
    const run = await fake({
      steps: [{ stderr: "/x/clip.mp4: No such file or directory\n" }],
      exitCode: 1,
    });
    const error = await failure(ffprobe("/x/clip.mp4", run.options));
    expect(error.exitCode).toBe(1);
    expect(error.stderrTail).toEqual(["/x/clip.mp4: No such file or directory"]);
  });

  it("lets one fake scenario answer different URLs (test fixture)", async () => {
    const run = await FakeRun.create({
      steps: [{ stdout: await fixture("probe-video.json") }],
      variants: [
        {
          whenArg: "https://example.org/list",
          steps: [{ stdout: await fixture("probe-playlist.json") }],
        },
      ],
    });
    try {
      expect((await probe("https://example.org/v", run.options)).kind).toBe("video");
      expect((await probe("https://example.org/list", run.options)).kind).toBe("playlist");
    } finally {
      await run.close();
    }
  });

  it("tells yt-dlp to run JavaScript challenges with the given Node", async () => {
    const run = await FakeRun.create({ steps: [{ stdout: await fixture("probe-video.json") }] });
    try {
      await probe("https://example.org/v", { ...run.options, jsRuntime: "/usr/local/bin/node" });
      const argv = await run.argv();
      expect(argv[argv.indexOf("--js-runtimes") + 1]).toBe("node:/usr/local/bin/node");
      await expect(
        probe("https://example.org/v", { ...run.options, jsRuntime: "node" }),
      ).rejects.toMatchObject({
        kind: "invalid_arguments",
      });
    } finally {
      await run.close();
    }
  });
});
