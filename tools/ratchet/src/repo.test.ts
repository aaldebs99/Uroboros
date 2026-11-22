import { describe, expect, it } from "vitest";

import { extension, isGovernedSource, splitNul } from "./repo.ts";

describe("repo", () => {
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
