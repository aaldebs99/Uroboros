import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type Repo } from "./repo.ts";

/** Writes `files` (repo-relative path to content) into a fresh temp directory. */
export function tempRepo(files: Record<string, string>): Repo {
  const root = mkdtempSync(join(tmpdir(), "ratchet-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return { root, files: Object.keys(files).sort() };
}
