import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll } from "vitest";

import { type Repo } from "./repo.ts";

/** Every temp repo a test file made, removed once its tests are done (they used to pile up). */
const made: string[] = [];
afterAll(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Writes `files` (repo-relative path to content) into a fresh temp directory. */
export function tempRepo(files: Record<string, string>): Repo {
  const root = mkdtempSync(join(tmpdir(), "ratchet-"));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return { root, files: Object.keys(files).sort() };
}
