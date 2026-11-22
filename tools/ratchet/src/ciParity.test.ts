import { describe, expect, it } from "vitest";

import { ciDepends, runCiParity, workflowTasks } from "./ciParity.ts";
import { execute } from "./main.ts";
import { isOk, renderFailure } from "./report.ts";
import { tempRepo } from "./testRepo.ts";

const mise = (depends: string[]): string =>
  `[tasks.ci]\ndepends = [${depends.map((d) => `"${d}"`).join(", ")}]\n`;
const workflow = (tasks: string[]): string =>
  `jobs:\n  ci:\n    steps:\n${tasks.map((t) => `      - run: mise run ${t}\n`).join("")}`;

describe("ci-parity", () => {
  it("passes when both sets match", () => {
    const repo = tempRepo({
      ".github/workflows/ci.yml": workflow(["a", "b"]),
      ".mise/config.toml": mise(["b", "a"]),
    });
    expect(isOk(runCiParity(repo))).toBe(true);
  });

  it("lists c when ci.yml runs {a,b} and depends is {a,b,c}", () => {
    const repo = tempRepo({
      ".github/workflows/ci.yml": workflow(["a", "b"]),
      ".mise/config.toml": mise(["a", "b", "c"]),
    });
    const text = renderFailure(runCiParity(repo));
    expect(text).toContain("never runs:\n  c\n");
  });

  it("lists tasks present only in ci.yml", () => {
    const repo = tempRepo({
      ".github/workflows/ci.yml": workflow(["a", "ci-only"]),
      ".mise/config.toml": mise(["a"]),
    });
    expect(renderFailure(runCiParity(repo))).toContain(
      "missing from [tasks.ci].depends:\n  ci-only\n",
    );
  });

  it("exits 2 when ci.yml is missing", async () => {
    const repo = tempRepo({ ".mise/config.toml": mise(["a"]) });
    const result = await execute(["ci-parity"], repo);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(".github/workflows/ci.yml");
  });

  it("exits 1 on a mismatch and 0 on a match", async () => {
    const bad = tempRepo({
      ".github/workflows/ci.yml": workflow(["a"]),
      ".mise/config.toml": mise(["a", "c"]),
    });
    expect((await execute(["ci-parity"], bad)).code).toBe(1);
    const good = tempRepo({
      ".github/workflows/ci.yml": workflow(["a"]),
      ".mise/config.toml": mise(["a"]),
    });
    expect((await execute(["ci-parity"], good)).code).toBe(0);
  });

  it("refuses to compare empty sets", () => {
    const empty = tempRepo({
      ".github/workflows/ci.yml": "jobs: {}\n",
      ".mise/config.toml": mise(["a"]),
    });
    expect(() => runCiParity(empty)).toThrow(/no `mise run <task>` steps/);
    const noDeps = tempRepo({
      ".github/workflows/ci.yml": workflow(["a"]),
      ".mise/config.toml": mise([]),
    });
    expect(() => runCiParity(noDeps)).toThrow(/depends is empty/);
  });

  it("parses workflow tasks, ignoring comments and trailing text", () => {
    const text = [
      "      - run: mise run lint:rust",
      "#     - run: mise run commented:out",
      "      - run: mise run test && mise run   check:gen",
      "      - run: mise run ratchet:pins # trailing",
      "      - run: mise run ",
    ].join("\n");
    expect([...workflowTasks(text)].sort()).toEqual([
      "check:gen",
      "lint:rust",
      "ratchet:pins",
      "test",
    ]);
  });

  it("reads depends as an array or a whitespace separated string", () => {
    expect([...ciDepends('[tasks.ci]\ndepends = ["x", "y"]\n')]).toEqual(["x", "y"]);
    expect([...ciDepends('[tasks.ci]\ndepends = "x y"\n')]).toEqual(["x", "y"]);
    expect(() => ciDepends("[tasks.other]\n")).toThrow(/no \[tasks.ci\]/);
    expect(() => ciDepends("[tasks.ci]\ndepends = [1]\n")).toThrow(/non-string/);
  });
});
