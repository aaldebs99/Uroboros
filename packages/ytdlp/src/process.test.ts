import { afterEach, describe, expect, it } from "vitest";
import { checkRun, runProcess } from "./process.ts";
import { YtDlpError } from "./errors.ts";
import { FakeRun } from "./testFake.ts";

const runs: FakeRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((r) => r.close()));
});

async function fake(scenario: Parameters<typeof FakeRun.create>[0]) {
  const run = await FakeRun.create(scenario);
  runs.push(run);
  return run;
}

describe("runProcess's stdout cap", () => {
  it("stops a process whose output outgrows the cap, and reports it as invalid output", async () => {
    const run = await fake({ steps: [{ stdout: "x".repeat(4096) }, { hang: true }] });
    const result = await runProcess({
      ...run.options,
      args: [],
      killGraceMs: 200,
      stderrTailLines: 5,
      maxStdout: 1024,
    });
    expect(result.stopped).toBe("output_too_large");
    // Nothing past the cap was kept.
    expect(result.stdout.length).toBeLessThanOrEqual(1024);
    let error: unknown;
    try {
      checkRun(result);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(YtDlpError);
    expect(error).toMatchObject({
      kind: "invalid_output",
      message: "output exceeded the size cap",
    });
  });

  it("keeps output up to the cap whole", async () => {
    const run = await fake({ steps: [{ stdout: "y".repeat(1024) }] });
    const result = await runProcess({
      ...run.options,
      args: [],
      killGraceMs: 200,
      stderrTailLines: 5,
      maxStdout: 1024,
    });
    expect(result.stopped).toBeNull();
    expect(checkRun(result)).toBe("y".repeat(1024));
  });
});
