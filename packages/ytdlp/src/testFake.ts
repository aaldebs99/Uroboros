import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scenario } from "../fixtures/fakeBin.ts";

export type { Scenario, Step } from "../fixtures/fakeBin.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

/** The fake yt-dlp/ffprobe executable (see `fixtures/fakeBin.ts`). */
export const FAKE_BIN = join(FIXTURES, "fakeBin.ts");

export function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), "utf8");
}

/** A scratch directory holding one scenario for the fake, plus a work dir for downloads. */
export class FakeRun {
  readonly dir: string;
  readonly workDir: string;

  private constructor(dir: string, workDir: string) {
    this.dir = dir;
    this.workDir = workDir;
  }

  static async create(scenario: Scenario): Promise<FakeRun> {
    const dir = await mkdtemp(join(tmpdir(), "uroboros-ytdlp-test-"));
    const workDir = join(dir, "work");
    await writeFile(join(dir, "scenario.json"), JSON.stringify(scenario));
    await mkdir(workDir);
    return new FakeRun(dir, workDir);
  }

  /** The options that point a call at the fake. */
  get options(): { binary: string; env: Record<string, string> } {
    return {
      binary: FAKE_BIN,
      env: {
        FAKE_BIN_SCENARIO: join(this.dir, "scenario.json"),
        FAKE_BIN_ARGV: join(this.dir, "argv.json"),
      },
    };
  }

  /** The arguments the fake was last started with. */
  async argv(): Promise<string[]> {
    return JSON.parse(await readFile(join(this.dir, "argv.json"), "utf8")) as string[];
  }

  async close(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

/** True while a process with this pid exists. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
