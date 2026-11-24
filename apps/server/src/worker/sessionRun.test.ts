import { FakeRun } from "@uroboros/ytdlp/testing";
import { afterEach, describe, expect, it } from "vitest";
import { fmp4Stream } from "../../test/fmp4.ts";
import { runSegments, type RunHooks } from "./sessionRun.ts";

const runs: FakeRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((r) => r.close()));
});

const boundaries = [0, 6, 12, 15];

function recorder(gate: () => Promise<void> = () => Promise.resolve()) {
  const events: string[] = [];
  const hooks: RunHooks = {
    onInit: (bytes) => {
      events.push(`init ${String(bytes.length > 0)}`);
      return Promise.resolve();
    },
    onSegment: (index) => {
      events.push(`seg ${String(index)}`);
      return Promise.resolve();
    },
    gate,
  };
  return { events, hooks };
}

async function fake(steps: object[], exitCode = 0) {
  const run = await FakeRun.create({ steps, exitCode } as Parameters<typeof FakeRun.create>[0]);
  runs.push(run);
  return run;
}

describe("runSegments", () => {
  it("hands over the init, then each segment once the next begins, and the last at the end", async () => {
    const run = await fake([{ stdoutBase64: fmp4Stream([0, 2.5, 6, 8.5, 12]).toString("base64") }]);
    const { events, hooks } = recorder();
    const out = await runSegments({
      ...run.options,
      args: ["-i", "x"],
      boundaries,
      first: 0,
      signal: new AbortController().signal,
      hooks,
    });
    expect(events).toEqual(["init true", "seg 0", "seg 1", "seg 2"]);
    expect(out).toMatchObject({
      output: true,
      reachedEnd: true,
      stopped: false,
      error: null,
      last: 2,
    });
  });

  it("reports a failure before any output with ffmpeg's reason", async () => {
    const run = await fake(
      [{ stderr: "[h264_vaapi @ 0x1] No usable encoding entrypoint found\nConversion failed!\n" }],
      1,
    );
    const { events, hooks } = recorder();
    const out = await runSegments({
      ...run.options,
      args: [],
      boundaries,
      first: 0,
      signal: new AbortController().signal,
      hooks,
    });
    expect(events).toEqual([]);
    expect(out).toMatchObject({
      output: false,
      reachedEnd: false,
      error: "h264_vaapi: No usable encoding entrypoint found",
    });
  });

  it("does not hand over the segment being made when a run is stopped", async () => {
    const run = await fake([
      { stdoutBase64: fmp4Stream([0, 2.5, 6]).toString("base64") },
      { hang: true },
    ]);
    const { events, hooks } = recorder();
    const ac = new AbortController();
    setTimeout(() => {
      ac.abort();
    }, 300);
    const out = await runSegments({
      ...run.options,
      args: [],
      boundaries,
      first: 0,
      signal: ac.signal,
      hooks,
    });
    expect(events).toEqual(["init true", "seg 0"]);
    expect(out).toMatchObject({ stopped: true, reachedEnd: false, error: null });
  });

  it("reads no further while the gate is closed", async () => {
    const run = await fake([
      { stdoutBase64: fmp4Stream([0]).toString("base64") },
      { sleepMs: 100 },
      {
        stdoutBase64: fmp4Stream([0, 6, 12])
          .subarray(fmp4Stream([0]).length)
          .toString("base64"),
      },
    ]);
    let open: () => void = () => undefined;
    let closed = false;
    const gate = () => (closed ? new Promise<void>((r) => (open = r)) : Promise.resolve());
    const { events, hooks } = recorder(gate);
    const done = runSegments({
      ...run.options,
      args: [],
      boundaries,
      first: 0,
      signal: new AbortController().signal,
      hooks,
    });
    await new Promise((r) => setTimeout(r, 50));
    closed = true;
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toEqual(["init true"]);
    closed = false;
    open();
    await done;
    expect(events).toEqual(["init true", "seg 0", "seg 1", "seg 2"]);
  });
});
