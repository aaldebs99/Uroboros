import { describe, expect, it } from "vitest";

import { ciDepends, runCiParity, workflowTasks } from "./ciParity.ts";
import { execute } from "./main.ts";
import { isOk, renderFailure } from "./report.ts";
import { tempRepo } from "./testRepo.ts";

const mise = (depends: string[]): string =>
  `[tasks.ci]\ndepends = [${depends.map((d) => `"${d}"`).join(", ")}]\n`;
const workflow = (tasks: string[]): string =>
  `jobs:\n  gates:\n    steps:\n${tasks.map((t) => `      - run: mise run ${t}\n`).join("")}` +
  `  ci:\n    needs: [gates]\n    steps:\n      - run: echo ok\n`;

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

  it("parses one-line steps, ignoring comment lines and trailing comments", () => {
    const text = [
      "      - run: mise run lint:rust",
      "#     - run: mise run commented:out",
      "        # a mise run in an indented comment",
      "      - run: mise run ratchet:pins # trailing",
      "        run: mise run check:gen",
    ].join("\n");
    expect([...workflowTasks(text)].sort()).toEqual(["check:gen", "lint:rust", "ratchet:pins"]);
  });

  it.each([
    ['      - run: echo "mise run fake"'],
    ["      - run: mise run --jobs 4 test"],
    ["      - run: mise run test && mise run check:gen"],
    ["          mise run test"],
    ["      - run: mise run "],
    ["      - name: mise run test"],
  ])("refuses an ambiguous mention: %s", (line) => {
    expect(() => workflowTasks(`steps:\n${line}\n`)).toThrow(/:2 mentions `mise run`/);
  });

  it("reads depends as an array or a whitespace separated string", () => {
    expect([...ciDepends('[tasks.ci]\ndepends = ["x", "y"]\n')]).toEqual(["x", "y"]);
    expect([...ciDepends('[tasks.ci]\ndepends = "x y"\n')]).toEqual(["x", "y"]);
    expect(() => ciDepends("[tasks.other]\n")).toThrow(/no \[tasks.ci\]/);
    expect(() => ciDepends("[tasks.ci]\ndepends = [1]\n")).toThrow(/non-string/);
  });

  it("fails when a job with a gate step is not in the ci job's needs", () => {
    const text =
      "jobs:\n  a:\n    steps:\n      - run: mise run x\n" +
      "  b:\n    steps:\n      - run: mise run y\n" +
      "  ci:\n    needs: a\n    steps:\n      - run: echo ok\n";
    const repo = tempRepo({
      ".github/workflows/ci.yml": text,
      ".mise/config.toml": mise(["x", "y"]),
    });
    expect(renderFailure(runCiParity(repo))).toContain("does not need:\n  b\n");
  });

  it("fails on continue-on-error at any level, ignoring comments", () => {
    const text =
      "jobs:\n  a:\n    continue-on-error: true\n    steps:\n" +
      "      - run: mise run x\n        continue-on-error: ${{ true }}\n" +
      "      # continue-on-error: in a comment\n" +
      "  ci:\n    needs: [a]\n    steps:\n      - run: echo ok\n";
    const repo = tempRepo({
      ".github/workflows/ci.yml": text,
      ".mise/config.toml": mise(["x"]),
    });
    const out = renderFailure(runCiParity(repo));
    expect(out).toContain("line 3: continue-on-error: true");
    expect(out).toContain("line 6: continue-on-error: ${{ true }}");
    expect(out).not.toContain("in a comment");
  });

  it("is a layout error without a ci job that has needs", async () => {
    const repo = tempRepo({
      ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - run: mise run x\n",
      ".mise/config.toml": mise(["x"]),
    });
    const result = await execute(["ci-parity"], repo);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("no `ci` job with `needs:`");
  });
});
