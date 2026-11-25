import { describe, expect, it } from "vitest";

import { execute } from "./main.ts";
import { tempRepo } from "./testRepo.ts";

const many = (n: number): Record<string, string> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${String(i)}.ts`, "export {};\n"]));

describe("execute", () => {
  it("exits 2 for an unknown gate", async () => {
    const result = await execute(["nope"], tempRepo({}));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("usage");
  });

  it("exits 2 when frozen.json is missing or malformed", async () => {
    const result = await execute(["lines"], tempRepo(many(20)));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("tools/ratchet/frozen.json");
    const bad = tempRepo({ ...many(20), "tools/ratchet/frozen.json": '{ "lines": 3 }' });
    expect((await execute(["lines"], bad)).code).toBe(2);
  });

  it("exits 0 with an ok line on stdout when the gate passes", async () => {
    const frozen = '{ "lines": [], "complexity": [], "suppressions": [], "pixels": [] }';
    const repo = tempRepo({ ...many(20), "tools/ratchet/frozen.json": frozen });
    const result = await execute(["lines"], repo);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ratchet lines: ok");
  });

  it("exits 1 when a frozen entry matches nothing", async () => {
    const frozen = JSON.stringify({
      lines: [{ key: "ghost.ts", value: 1200, reason: "a long enough justification here" }],
      complexity: [],
      suppressions: [],
      pixels: [],
    });
    const repo = tempRepo({ ...many(20), "tools/ratchet/frozen.json": frozen });
    const result = await execute(["lines"], repo);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost.ts");
  });

  it("runs every gate for all, exiting with the worst of them", async () => {
    const frozen = JSON.stringify({
      lines: [{ key: "ghost.ts", value: 1200, reason: "a long enough justification here" }],
      complexity: [],
      suppressions: [],
      pixels: [],
    });
    const repo = tempRepo({ ...many(20), "tools/ratchet/frozen.json": frozen });
    const result = await execute(["all"], repo);
    // Lines fails (1); the gates this bare repo has no layout for error (2): the worst wins, and
    // one gate's failure hides none of the others' reports.
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("ghost.ts");
    expect(result.stdout).toContain("ratchet suppressions: ok");
    expect((await execute(["lines"], repo)).code).toBe(1);
    expect((await execute(["all", "extra"], repo)).code).toBe(2);
  });
});
