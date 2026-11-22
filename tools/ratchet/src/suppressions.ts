/**
 * `ratchet suppressions`: the number of lint-suppression escape hatches per file may only fall.
 *
 * Counted per governed file: occurrences of the ESLint disable directive (any form, including the
 * next-line and line variants) and the TypeScript ignore, expect-error and nocheck directives.
 * Every suppression is a place a
 * lint stopped protecting the code. The cap is zero; files that legitimately need some are frozen
 * in `frozen.json` at their exact count, with a reason.
 *
 * NOTE: the patterns are assembled by concatenation so this file does not count its own pattern
 * table as suppressions. Keep it that way if you edit them.
 */
import { frozenReport, type Frozen, type Wording } from "./frozen.ts";
import { type Report } from "./report.ts";
import { isGovernedSource, read, type Repo } from "./repo.ts";

const PATTERNS = [
  "eslint" + "-disable",
  "@ts" + "-ignore",
  "@ts" + "-expect-error",
  "@ts" + "-nocheck",
];

/** Vacuous-pass guard, same meaning as in `lines.ts`. Raise as the repo grows. */
export const MIN_SCANNED = 10;

const WORDING: Wording = {
  offenderHeading: "file(s) with new lint suppressions",
  unit: "hatches",
  list: "suppressions",
  fix: "Fix the code the lint flagged instead of silencing it. If the lint is wrong, narrow the suppression to one line and explain it in the comment.",
};

/**
 * Counts every occurrence of every pattern. Pure. No pattern is a substring of another, so
 * nothing is counted twice.
 */
export function countSuppressions(content: string): number {
  return PATTERNS.reduce((total, pattern) => total + content.split(pattern).length - 1, 0);
}

/** Per-file suppression counts for every governed file. */
export function measureSuppressions(repo: Repo): Map<string, number> {
  return new Map(
    repo.files
      .filter(isGovernedSource)
      .map((path) => [path, countSuppressions(read(repo.root, path))] as const),
  );
}

/** Decides the outcome. Pure. */
export function evaluateSuppressions(
  measured: Map<string, number>,
  frozen: Frozen[],
  minScanned: number,
): Report {
  const total = [...measured.values()].reduce((sum, n) => sum + n, 0);
  return frozenReport(
    "ratchet suppressions",
    `${String(measured.size)} file(s) scanned, ${String(total)} suppression(s), all within the baseline`,
    measured,
    0,
    frozen,
    WORDING,
    minScanned,
  );
}

export function runSuppressions(repo: Repo, frozen: Frozen[]): Report {
  return evaluateSuppressions(measureSuppressions(repo), frozen, MIN_SCANNED);
}
