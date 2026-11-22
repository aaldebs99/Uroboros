import { describe, expect, it } from "vitest";

import {
  isOk,
  newReport,
  problemCount,
  pushSection,
  renderFailure,
  renderOk,
  section,
} from "./report.ts";

describe("report", () => {
  it("drops empty sections and renders the success summary", () => {
    const report = newReport("demo", "3 files");
    pushSection(report, section("nothing", [], "n/a"));
    expect(isOk(report)).toBe(true);
    expect(renderOk(report)).toBe("demo: ok — 3 files\n");
  });

  it("renders items, advice and a final verdict on failure, without the summary", () => {
    const report = newReport("demo", "3 files");
    pushSection(report, section("thing(s) broke", ["a", "b"], "fix it\nthen rerun"));
    expect(isOk(report)).toBe(false);
    expect(problemCount(report)).toBe(2);
    const text = renderFailure(report);
    expect(text).toContain("2 thing(s) broke:\n  a\n  b\n");
    expect(text).toContain("  → fix it\n  → then rerun\n");
    expect(text.endsWith("demo: FAILED — 2 problem(s)\n")).toBe(true);
    expect(text).not.toContain("3 files");
  });
});
