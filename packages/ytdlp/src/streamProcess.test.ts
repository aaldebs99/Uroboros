import { afterEach, describe, expect, it } from "vitest";
import { alive, FakeRun, readWhenWritten, waitDead } from "./testFake.ts";
import { meaningfulLine, spawnStream } from "./streamProcess.ts";

const runs: FakeRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((r) => r.close()));
});
async function fake(scenario: Parameters<typeof FakeRun.create>[0]) {
  const run = await FakeRun.create(scenario);
  runs.push(run);
  return run;
}

async function collect(chunks: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of chunks) parts.push(c);
  return Buffer.concat(parts);
}

describe("spawnStream", () => {
  it("streams binary stdout and reports how the process ended", async () => {
    const bytes = Buffer.from([0, 1, 2, 255, 10, 13, 0]);
    const run = await fake({
      steps: [
        { stdoutBase64: bytes.toString("base64") },
        { stdoutBase64: bytes.toString("base64") },
        { stderr: "a warning\n" },
      ],
    });
    const p = spawnStream({ ...run.options, args: ["-i", "x"] });
    expect((await collect(p.stdout)).equals(Buffer.concat([bytes, bytes]))).toBe(true);
    expect(await p.exited).toEqual({ code: 0, stopped: false, stderrTail: ["a warning"] });
    expect(await run.argv()).toEqual(["-i", "x"]);
  });

  it("keeps the exit code and stderr of a failure", async () => {
    const run = await fake({ steps: [{ stderr: "line one\nConversion failed!\n" }], exitCode: 1 });
    const p = spawnStream({ ...run.options, args: [] });
    await collect(p.stdout);
    expect(await p.exited).toEqual({
      code: 1,
      stopped: false,
      stderrTail: ["line one", "Conversion failed!"],
    });
  });

  it("stops the whole process group, even one that ignores SIGTERM", async () => {
    const run = await fake({
      steps: [{ spawnSleeper: "sleeper.pid" }, { hang: true }],
      ignoreSigterm: true,
    });
    const p = spawnStream({ ...run.options, args: [], cwd: run.dir, killGraceMs: 200 });
    // The fake ignores SIGTERM from its start and writes the pid once the sleeper runs.
    const pid = Number(await readWhenWritten(`${run.dir}/sleeper.pid`));
    expect(alive(pid)).toBe(true);
    p.stop();
    expect((await p.exited).stopped).toBe(true);
    expect(await waitDead(pid)).toBe(true);
  });

  it("stops when its signal aborts", async () => {
    const run = await fake({ steps: [{ hang: true }] });
    const controller = new AbortController();
    const p = spawnStream({ ...run.options, args: [], signal: controller.signal });
    setTimeout(() => {
      controller.abort();
    }, 200);
    expect((await p.exited).stopped).toBe(true);
  });

  it("rejects when the binary can't start", async () => {
    const p = spawnStream({ binary: "/nonexistent/ffmpeg", args: [] });
    await expect(p.exited).rejects.toMatchObject({ kind: "spawn_failed" });
  });
});

describe("meaningfulLine", () => {
  it("skips ffmpeg's generic closing lines and names the component", () => {
    expect(
      meaningfulLine([
        "[Parsed_tonemap_cuda_1 @ 0x79676c003980] No DOVI metadata and unsupported input transfer characteristic: unknown",
        "[vf#0:0 @ 0x55595fb625c0] Error while filtering: Invalid argument",
        "[vf#0:0 @ 0x55595fb625c0] Task finished with error code: -22 (Invalid argument)",
        "[vost#0:0/h264_nvenc @ 0x55] Terminating thread with return code -22 (Invalid argument)",
        "[out#0/mp4 @ 0x55] Nothing was written into output file, because at least one of its streams received no packets.",
        "Conversion failed!",
      ]),
    ).toBe("tonemap_cuda: No DOVI metadata and unsupported input transfer characteristic: unknown");
    expect(
      meaningfulLine(["[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: unsupported device (2)"]),
    ).toBe("h264_nvenc: OpenEncodeSessionEx failed: unsupported device (2)");
    expect(meaningfulLine(["/x.mkv: No such file or directory"])).toBe(
      "/x.mkv: No such file or directory",
    );
  });

  it("falls back to the last line, or a plain message", () => {
    expect(meaningfulLine(["Conversion failed!"])).toBe("Conversion failed!");
    expect(meaningfulLine([])).toBe("ffmpeg failed");
  });
});
