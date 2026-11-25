import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isOk, renderFailure } from "./report.ts";
import { countSuppressions, evaluateSuppressions, measureSuppressions } from "./suppressions.ts";
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

  it("fails any suppression the baseline doesn't list: the cap is zero", () => {
    const report = evaluateSuppressions(new Map([["a.ts", 1]]), [], 1);
    expect(isOk(report)).toBe(false);
    expect(renderFailure(report)).toContain("a.ts");
    expect(isOk(evaluateSuppressions(new Map([["a.ts", 0]]), [], 1))).toBe(true);
  });

  it("accepts a frozen file at exactly its count, and fails slack or a stale entry", () => {
    const frozen = (value: number) => [
      { key: "a.ts", value, reason: "a vendored shim, gone once upstream ships types" },
    ];
    expect(isOk(evaluateSuppressions(new Map([["a.ts", 2]]), frozen(2), 1))).toBe(true);
    expect(renderFailure(evaluateSuppressions(new Map([["a.ts", 1]]), frozen(2), 1))).toContain(
      "(slack)",
    );
    expect(isOk(evaluateSuppressions(new Map([["a.ts", 0]]), frozen(2), 1))).toBe(false);
  });

  it("fails a scan that found fewer files than its floor", () => {
    expect(isOk(evaluateSuppressions(new Map([["a.ts", 0]]), [], 2))).toBe(false);
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
