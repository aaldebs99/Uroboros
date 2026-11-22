#!/usr/bin/env node
/**
 * `ratchet <lines|complexity|suppressions|pins|ci-parity|all>`: repository gates that are easier
 * to express in code than in shell.
 *
 * Exit codes: 0 the gate passed, 1 the gate found violations, 2 the gate could not run (missing
 * file, unparsable config, git failure, bad arguments). A 2 is never a pass.
 *
 * Success summaries go to stdout; failure listings and errors go to stderr.
 */
import { runCiParity } from "./ciParity.ts";
import { runComplexity } from "./complexity.ts";
import { loadFrozen } from "./frozen.ts";
import { runLines } from "./lines.ts";
import { runPins } from "./pins.ts";
import { isOk, renderFailure, renderOk, type Report } from "./report.ts";
import { discover, repoRoot, type Repo } from "./repo.ts";
import { runSuppressions } from "./suppressions.ts";

export type Outcome = { code: 0 | 1 | 2; stdout: string; stderr: string };

type Gate = (repo: Repo) => Report | Promise<Report>;

const GATES: Record<string, Gate> = {
  lines: (repo) => runLines(repo, loadFrozen(repo.root).lines),
  complexity: (repo) => runComplexity(repo, loadFrozen(repo.root).complexity),
  suppressions: (repo) => runSuppressions(repo, loadFrozen(repo.root).suppressions),
  pins: runPins,
  "ci-parity": runCiParity,
};

const USAGE = `usage: ratchet <${[...Object.keys(GATES), "all"].join("|")}>`;

async function runGate(name: string, repo: Repo): Promise<Outcome> {
  const gate = GATES[name];
  if (!gate) {
    return { code: 2, stdout: "", stderr: `ratchet: error: unknown gate "${name}"\n${USAGE}\n` };
  }
  try {
    const report = await gate(repo);
    return isOk(report)
      ? { code: 0, stdout: renderOk(report), stderr: "" }
      : { code: 1, stdout: "", stderr: renderFailure(report) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 2, stdout: "", stderr: `ratchet ${name}: error: ${message}\n` };
  }
}

/** Runs one gate, or every gate for `all`. Pure of process state: callers print and exit. */
export async function execute(argv: string[], repo: Repo): Promise<Outcome> {
  const [name, ...extra] = argv;
  if (name === undefined || extra.length > 0) {
    return { code: 2, stdout: "", stderr: `${USAGE}\n` };
  }
  if (name !== "all") {
    return runGate(name, repo);
  }
  const outcomes: Outcome[] = [];
  for (const gate of Object.keys(GATES)) {
    outcomes.push(await runGate(gate, repo));
  }
  return {
    code: Math.max(...outcomes.map((o) => o.code)) as Outcome["code"],
    stdout: outcomes.map((o) => o.stdout).join(""),
    stderr: outcomes.map((o) => o.stderr).join(""),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let outcome: Outcome;
  try {
    outcome = await execute(argv, discover(repoRoot()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcome = { code: 2, stdout: "", stderr: `ratchet: error: ${message}\n` };
  }
  process.stdout.write(outcome.stdout);
  process.stderr.write(outcome.stderr);
  process.exitCode = outcome.code;
}

if (import.meta.main) {
  void main();
}
