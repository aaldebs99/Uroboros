/**
 * `ci-parity`: the local `mise run ci` gate and the CI workflow must run the same tasks.
 *
 * `[tasks.ci]` promises "if this passes locally, it passes in CI". That promise goes quietly false
 * the day someone adds a step to `.github/workflows/ci.yml` without adding the task to
 * `[tasks.ci].depends` (or the reverse). This gate compares the two sets in both directions.
 *
 * Both sets are checked for emptiness first: a renamed workflow or a reshaped `depends` would
 * otherwise compare nothing to nothing and pass, so an empty set is a layout error (exit 2).
 */
import { parse as parseToml } from "smol-toml";

import { newReport, pushSection, section, type Report } from "./report.ts";
import { LayoutError, read, type Repo } from "./repo.ts";

const WORKFLOW = ".github/workflows/ci.yml";
const MISE = ".mise/config.toml";
const TASK = /mise run +([a-z0-9:_-]+)/g;

/** Every task invoked as `mise run <task>` in a workflow. YAML comment lines are ignored. */
export function workflowTasks(text: string): Set<string> {
  const tasks = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("#")) {
      continue;
    }
    for (const match of line.matchAll(TASK)) {
      if (match[1] !== undefined) {
        tasks.add(match[1]);
      }
    }
  }
  return tasks;
}

function tomlTable(text: string): Record<string, unknown> {
  try {
    return parseToml(text);
  } catch (error) {
    throw new LayoutError(
      `cannot parse ${MISE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function child(table: unknown, key: string): unknown {
  return typeof table === "object" && table !== null
    ? (table as Record<string, unknown>)[key]
    : undefined;
}

/**
 * `[tasks.ci].depends` from the mise config. Accepts an array of strings or a single
 * whitespace-separated string.
 */
export function ciDepends(text: string): Set<string> {
  const ci = child(child(tomlTable(text), "tasks"), "ci");
  if (ci === undefined) {
    throw new LayoutError(`${MISE} has no [tasks.ci]`);
  }
  const depends = child(ci, "depends");
  if (depends === undefined) {
    throw new LayoutError(`${MISE} [tasks.ci] has no \`depends\``);
  }
  if (typeof depends === "string") {
    return new Set(depends.split(/\s+/).filter((name) => name !== ""));
  }
  if (!Array.isArray(depends)) {
    throw new LayoutError(`${MISE} [tasks.ci].depends must be an array of task names`);
  }
  const names = new Set<string>();
  for (const item of depends) {
    if (typeof item !== "string") {
      throw new LayoutError(`${MISE} [tasks.ci].depends contains a non-string: ${String(item)}`);
    }
    names.add(item);
  }
  return names;
}

function difference(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((name) => !b.has(name)).sort();
}

/** Decides the outcome. Pure. Empty inputs are an error, never a pass. */
export function evaluateCiParity(ci: Set<string>, local: Set<string>): Report {
  if (ci.size === 0) {
    throw new LayoutError(
      `found no \`mise run <task>\` steps in ${WORKFLOW}; refusing to compare an empty set`,
    );
  }
  if (local.size === 0) {
    throw new LayoutError(`${MISE} [tasks.ci].depends is empty; refusing to compare an empty set`);
  }
  const report = newReport(
    "ci-parity",
    `${String(ci.size)} task(s) run identically by CI and \`mise run ci\``,
  );
  pushSection(
    report,
    section(
      `task(s) run in ${WORKFLOW} but missing from [tasks.ci].depends`,
      difference(ci, local),
      `Add each task to \`depends\` under [tasks.ci] in ${MISE}, so \`mise run ci\` locally runs everything CI runs.`,
    ),
  );
  pushSection(
    report,
    section(
      `task(s) in [tasks.ci].depends that ${WORKFLOW} never runs`,
      difference(local, ci),
      `Add a \`run: mise run <task>\` step for each to ${WORKFLOW} (or remove it from [tasks.ci].depends if it is not a gate). CI must run every local gate.`,
    ),
  );
  return report;
}

export function runCiParity(repo: Repo): Report {
  const ci = workflowTasks(read(repo.root, WORKFLOW));
  const local = ciDepends(read(repo.root, MISE));
  return evaluateCiParity(ci, local);
}
