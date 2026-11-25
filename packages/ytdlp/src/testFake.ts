import { existsSync, readFileSync } from "node:fs";
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

  /** A file a `copyArgFile` step saved, or null when none was. */
  async copied(name: string): Promise<string | null> {
    try {
      return await readFile(join(this.dir, name), "utf8");
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

/** The contents of `path` once a fake has written it, polling for up to 5 s. */
export async function readWhenWritten(path: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((done) => setTimeout(done, 25));
    }
  }
  throw new Error(`${path} never appeared`);
}

/** True once the process is gone (see `alive`), polling for up to 2 s. */
export async function waitDead(pid: number): Promise<boolean> {
  for (let i = 0; i < 80 && alive(pid); i++) {
    await new Promise((done) => setTimeout(done, 25));
  }
  return !alive(pid);
}

/**
 * True while a process with this pid runs. A killed process whose parent is gone waits as a
 * zombie until the system's init reaps it, and a CI job's container may have an init that never
 * does (its PID 1 is the job's own process), so on Linux a zombie counts as dead: it was killed,
 * and only the reaping is left. `kill(pid, 0)` alone succeeds on a zombie.
 */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (!existsSync("/proc/self/stat")) return true;
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    // The state is the field after the command name, which is in parentheses and may hold spaces.
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ", 1)[0] !== "Z";
  } catch {
    return false;
  }
}
