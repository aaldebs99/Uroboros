import { describe, expect, it } from "vitest";

import { evaluate, type Frozen } from "./frozen.ts";

const LONG_REASON = "frozen until the module is split into siblings";

function entry(key: string, value: number, reason = LONG_REASON): Frozen {
  return { key, value, reason };
}

describe("frozen.evaluate with a cap of 10", () => {
  it("reports an unfrozen value over the cap as an offender", () => {
    expect(evaluate(new Map([["a", 12]]), 10, [])).toEqual([
      { kind: "offender", key: "a", value: 12 },
    ]);
  });

  it("reports growth past the frozen number as a regression", () => {
    expect(evaluate(new Map([["a", 12]]), 10, [entry("a", 11)])).toEqual([
      { kind: "regression", key: "a", value: 12, frozen: 11 },
    ]);
  });

  it("reports improvement below the frozen number as slack", () => {
    expect(evaluate(new Map([["a", 12]]), 10, [entry("a", 13)])).toEqual([
      { kind: "slack", key: "a", value: 12, frozen: 13 },
    ]);
  });

  it("reports a frozen entry at or under the cap as stale", () => {
    expect(evaluate(new Map([["a", 9]]), 10, [entry("a", 9)])).toEqual([
      { kind: "stale", key: "a", value: 9, frozen: 9 },
    ]);
  });

  it("reports a frozen key that was never measured as unknown", () => {
    expect(evaluate(new Map([["a", 1]]), 10, [entry("zzz", 11)])).toEqual([
      { kind: "unknown", key: "zzz", frozen: 11 },
    ]);
  });

  it("reports a key frozen twice as a duplicate", () => {
    expect(evaluate(new Map([["a", 12]]), 10, [entry("a", 12), entry("a", 12)])).toEqual([
      { kind: "duplicate", key: "a" },
    ]);
  });

  it("reports a reason of 20 characters or fewer as unjustified", () => {
    const findings = evaluate(new Map([["a", 12]]), 10, [entry("a", 12, "too long")]);
    expect(findings).toEqual([{ kind: "unjustified", key: "a" }]);
    expect(evaluate(new Map([["a", 12]]), 10, [entry("a", 12, "x".repeat(20))])).toHaveLength(1);
    expect(evaluate(new Map([["a", 12]]), 10, [entry("a", 12, "x".repeat(21))])).toEqual([]);
  });

  it("passes a frozen entry exactly at its frozen number over the cap", () => {
    expect(evaluate(new Map([["a", 12]]), 10, [entry("a", 12)])).toEqual([]);
  });

  it("passes values at or under the cap with nothing frozen", () => {
    expect(evaluate(new Map([["a", 10]]), 10, [])).toEqual([]);
  });

  it("orders the worst offenders first, then by key", () => {
    const measured = new Map([
      ["b", 11],
      ["a", 11],
      ["c", 30],
    ]);
    expect(evaluate(measured, 10, []).map((f) => f.key)).toEqual(["c", "a", "b"]);
  });
});
