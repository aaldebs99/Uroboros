import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A go-ahead for a fake run: put `step` in its scenario and the run waits there until `go()`, so
 * it lasts exactly until the test has done what it does meanwhile, never a guessed number of ms.
 */
export async function fakeGate(): Promise<{
  step: { waitForFile: string };
  go(): Promise<void>;
  close(): Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "uroboros-gate-"));
  const file = join(dir, "go");
  return {
    step: { waitForFile: file },
    go: () => writeFile(file, ""),
    close: () => rm(dir, { recursive: true, force: true }),
  };
}
