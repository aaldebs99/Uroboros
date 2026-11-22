import { describe, expect, it } from "vitest";

import { evaluateLines, measureLines, scanContent } from "./lines.ts";
import { renderFailure, isOk } from "./report.ts";
import { tempRepo } from "./testRepo.ts";

const lines = (n: number): string => "x\n".repeat(n);

describe("lines", () => {
  it("fails a 1001-line file as an offender", () => {
    const report = evaluateLines([scanContent("big.ts", lines(1001))], [], 1);
    expect(isOk(report)).toBe(false);
    expect(renderFailure(report)).toContain("1001 lines  big.ts");
  });

  it("passes a 1000-line file", () => {
    expect(isOk(evaluateLines([scanContent("ok.ts", lines(1000))], [], 1))).toBe(true);
  });

  it("fails a file containing a NUL byte, with its line", () => {
    const report = evaluateLines([scanContent("bin.ts", "a\nb\0c\n")], [], 1);
    expect(renderFailure(report)).toContain("line     2  bin.ts");
  });

  it("fails when fewer files are scanned than the vacuous-pass floor", () => {
    const report = evaluateLines([scanContent("a.ts", "x\n")], [], 2);
    expect(renderFailure(report)).toContain("scanned 1 governed file(s), expected at least 2");
  });

  it("accepts a frozen file at exactly its number and flags slack", () => {
    const scans = [scanContent("big.ts", lines(1200))];
    const frozen = (value: number) => [
      { key: "big.ts", value, reason: "split is planned for the next milestone" },
    ];
    expect(isOk(evaluateLines(scans, frozen(1200), 1))).toBe(true);
    expect(renderFailure(evaluateLines(scans, frozen(1300), 1))).toContain("(slack)");
  });

  it("measures only governed files, skipping generated and non-source paths", () => {
    const repo = tempRepo({
      "a.ts": lines(3),
      "src/generated/api.ts": lines(2000),
      "dist/out.js": lines(2000),
      "notes.md": lines(2000),
    });
    expect(measureLines(repo).map((s) => s.path)).toEqual(["a.ts"]);
  });
});
