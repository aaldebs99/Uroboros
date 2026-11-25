import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { YtDlpError } from "./errors.ts";
import { downloadSubtitles } from "./subtitles.ts";
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

const URL = "http://127.0.0.1:18765/clip.mp4";
const SUBS = ["--write-subs", "--sub-langs=en.*", "--convert-subs=vtt"];

describe("downloadSubtitles", () => {
  it("fetches only the subtitles, and the info yt-dlp wrote beside them", async () => {
    const run = await fake({
      steps: [
        { writeFile: "clip.info.json", content: await fixture("info-clip.json") },
        { writeFile: "clip.en.vtt", content: "WEBVTT\n" },
        { writeFile: "clip.en-GB.vtt", content: "WEBVTT\n" },
      ],
    });
    const result = await downloadSubtitles(URL, {
      ...run.options,
      workDir: run.workDir,
      extraArgs: SUBS,
    });
    expect(result.files).toEqual([
      join(run.workDir, "clip.en-GB.vtt"),
      join(run.workDir, "clip.en.vtt"),
    ]);
    expect(result.info.title).toBeTruthy();
    const argv = await run.argv();
    expect(argv).toEqual(expect.arrayContaining(["--skip-download", "--write-info-json", ...SUBS]));
    expect(argv.at(-1)).toBe(URL);
  });

  it("fails as any run does, with the site's cooldown on a rate limit", async () => {
    const run = await fake({
      steps: [
        {
          stderr:
            "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests\n",
        },
      ],
      exitCode: 1,
    });
    const err = await downloadSubtitles(URL, {
      ...run.options,
      workDir: run.workDir,
      extraArgs: SUBS,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YtDlpError);
    expect((err as YtDlpError).kind).toBe("rate_limited");
  });

  it("fails as unreadable output when yt-dlp wrote no info", async () => {
    const run = await fake({ steps: [{ writeFile: "clip.en.vtt", content: "WEBVTT\n" }] });
    const err = await downloadSubtitles(URL, {
      ...run.options,
      workDir: run.workDir,
      extraArgs: SUBS,
    }).catch((e: unknown) => e);
    expect((err as YtDlpError).kind).toBe("invalid_output");
  });
});
