import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateComplexity, measureComplexity, parseScore } from "./complexity.ts";
import { isOk, renderFailure } from "./report.ts";
import { tempRepo } from "./testRepo.ts";

const nested = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "nested.ts.fixture"),
  "utf8",
);

describe("parseScore", () => {
  it("reads the score out of the sonarjs message", () => {
    expect(
      parseScore(
        "Refactor this function to reduce its Cognitive Complexity from 27 to the 0 allowed.",
      ),
    ).toBe(27);
  });

  it("throws on a message it does not understand", () => {
    expect(() => parseScore("something else entirely")).toThrow(/cognitive complexity score/i);
  });
});

describe("measureComplexity", () => {
  it("scores an if inside a for inside a function as 3", async () => {
    const repo = tempRepo({ "nested.ts": nested });
    const { files, unparsed } = await measureComplexity(repo);
    expect(unparsed).toEqual([]);
    expect(files).toEqual([{ path: "nested.ts", functions: [{ name: "nested", score: 3 }] }]);
  });

  it("names arrows, methods and anonymous functions, numbering repeats", async () => {
    const repo = tempRepo({
      "m.ts": [
        "export const arrow = (x: number) => { if (x) { return 1; } return 0; };",
        "export class K { run(x: number) { if (x) { return 1; } return 0; } }",
        "export const o = { run(x: number) { if (x) { return 1; } return 0; } };",
        "export default function (x: number) { if (x) { return 1; } return 0; }",
        "",
      ].join("\n"),
    });
    const { files } = await measureComplexity(repo);
    expect(files[0]?.functions.map((f) => f.name)).toEqual(["arrow", "run", "run", "<anonymous>"]);
  });

  it("is not hidden by inline directive comments", async () => {
    const directive = "eslint" + "-disable";
    const source = `/* ${directive} sonarjs/cognitive-complexity */\nexport function f(x: number) { if (x) { return 1; } return 0; }\n`;
    const { files } = await measureComplexity(tempRepo({ "d.ts": source }));
    expect(files[0]?.functions[0]?.score).toBe(1);
  });

  it("reports a file that cannot be parsed", async () => {
    const { files, unparsed } = await measureComplexity(tempRepo({ "bad.ts": "function (" }));
    expect(files).toEqual([]);
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]).toContain("bad.ts");
  });
});

describe("evaluateComplexity", () => {
  const fn = (name: string, score: number) => ({ name, score });

  it("fails a function over 25 as an offender keyed path::name", () => {
    const report = evaluateComplexity([{ path: "a.ts", functions: [fn("big", 26)] }], [], [], 1);
    expect(renderFailure(report)).toContain("a.ts::big");
  });

  it("passes a function at exactly 25", () => {
    const report = evaluateComplexity([{ path: "a.ts", functions: [fn("ok", 25)] }], [], [], 1);
    expect(isOk(report)).toBe(true);
  });

  it("fails a file whose functions sum to 201 as a file-sum offender", () => {
    const functions = [
      ...Array.from({ length: 8 }, (_, i) => fn(`f${String(i)}`, 25)),
      fn("last", 1),
    ];
    const report = evaluateComplexity([{ path: "sum.ts", functions }], [], [], 1);
    const text = renderFailure(report);
    expect(text).toContain("summed cognitive-complexity cap of 200");
    expect(text).toContain("201 cognitive  sum.ts");
  });

  it("passes a file summing to exactly 200", () => {
    const functions = Array.from({ length: 8 }, (_, i) => fn(`f${String(i)}`, 25));
    expect(isOk(evaluateComplexity([{ path: "s.ts", functions }], [], [], 1))).toBe(true);
  });

  it("suffixes repeated names with their order of appearance", () => {
    const functions = [fn("run", 26), fn("run", 27)];
    const text = renderFailure(evaluateComplexity([{ path: "r.ts", functions }], [], [], 1));
    expect(text).toContain("r.ts::run#1");
    expect(text).toContain("r.ts::run#2");
  });

  it("splits frozen entries into function (path::name) and file (path) exceptions", () => {
    const frozen = [
      { key: "a.ts::big", value: 26, reason: "legacy parser, rewrite tracked separately" },
    ];
    const report = evaluateComplexity(
      [{ path: "a.ts", functions: [fn("big", 26)] }],
      [],
      frozen,
      1,
    );
    expect(isOk(report)).toBe(true);
  });

  it("fails when a file could not be parsed", () => {
    const report = evaluateComplexity([], ["bad.ts: boom"], [], 0);
    expect(renderFailure(report)).toContain("bad.ts: boom");
  });
});
