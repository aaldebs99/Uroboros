import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { extension, isGovernedSource, listedFiles, splitNul } from "./repo.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("repo", () => {
  it("lists tracked and new files, not ignored ones, deleted ones or symlinks", () => {
    const root = mkdtempSync(join(tmpdir(), "ratchet-listed-"));
    roots.push(root);
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: root,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.com",
        },
        stdio: "ignore",
      });
    git("init", "-q");
    for (const name of ["tracked.ts", "gone.ts", ".gitignore"]) {
      writeFileSync(join(root, name), name === ".gitignore" ? "ignored.ts\n" : "export {};\n");
    }
    git("add", ".");
    git("commit", "-qm", "init");
    writeFileSync(join(root, "new file ü.ts"), "export {};\n");
    writeFileSync(join(root, "ignored.ts"), "export {};\n");
    symlinkSync("tracked.ts", join(root, "link.ts"));
    rmSync(join(root, "gone.ts"));
    expect(listedFiles(root)).toEqual([".gitignore", "new file ü.ts", "tracked.ts"]);
  });

  it("splitNul drops empty entries", () => {
    expect(splitNul("a.ts\0dir/b.ts\0\0")).toEqual(["a.ts", "dir/b.ts"]);
  });

  it.each([
    ["src/main.ts", "ts"],
    ["web/App.TSX", "tsx"],
    ["dir.d/Makefile", undefined],
    [".gitignore", undefined],
    ["trailing.", undefined],
    ["a/b/c.test.ts", "ts"],
  ])("extension(%s)", (path, want) => {
    expect(extension(path)).toBe(want);
  });

  it.each([
    ["a.ts", true],
    ["a.tsx", true],
    ["a.js", true],
    ["a.mjs", true],
    ["a.json", false],
    ["a.md", false],
    ["api/openapi.json", false],
    ["apps/web/dist/a.js", false],
    ["apps/web/src/api/generated/a.ts", false],
  ])("isGovernedSource(%s) is %s", (path, want) => {
    expect(isGovernedSource(path)).toBe(want);
  });
});
