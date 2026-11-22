import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { countSuppressions, measureSuppressions } from "./suppressions.ts";
import { tempRepo } from "./testRepo.ts";

const ES = "eslint" + "-disable";

const fixture = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "suppressions.ts.fixture"),
  "utf8",
);

describe("suppressions", () => {
  it("counts 2 next-line disables and 1 expect-error as 3", () => {
    expect(countSuppressions(fixture)).toBe(3);
  });

  it("counts every marker kind", () => {
    const text = [ES, "@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("\n");
    expect(countSuppressions(text)).toBe(4);
  });

  it("measures per governed file, including files with zero", () => {
    const repo = tempRepo({ "a.ts": fixture, "b.ts": "export {};\n", "c.md": ES });
    expect(measureSuppressions(repo)).toEqual(
      new Map([
        ["a.ts", 3],
        ["b.ts", 0],
      ]),
    );
  });
});
