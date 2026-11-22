/**
 * `ratchet complexity`: cognitive complexity caps, measured with `eslint-plugin-sonarjs`.
 *
 * Two caps, both inclusive:
 * - per function: cognitive complexity <= 25;
 * - per file: the SUM of its functions' cognitive complexity <= 200.
 *
 * The score is SonarSource's cognitive complexity, the same metric the Rust template computes
 * with arborist. It comes from `sonarjs/cognitive-complexity` run through ESLint's Node API at
 * threshold 0, so every function with a non-zero score is reported, and the number is parsed out of
 * the message text. An override config enables only that rule, so no other lint rule (and no
 * inline ESLint disable comment) can affect the measurement.
 *
 * The file cap is a SUM, so extracting a helper function in the same file does not lower it.
 * Relieving it means moving code into a sibling module.
 */
import { relative } from "node:path";

import { ESLint } from "eslint";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

import { collectorRule, contains, type FunctionSpan, type Position } from "./functionNames.ts";
import { renderFindings, evaluate, scanFloor, type Frozen, type Wording } from "./frozen.ts";
import { newReport, pushSection, section, type Report } from "./report.ts";
import { isGovernedSource, LayoutError, type Repo } from "./repo.ts";

/** Maximum cognitive complexity of any single function. */
export const MAX_FUNCTION = 25;

/** Maximum SUM of cognitive complexity across the functions of one file. */
export const MAX_FILE = 200;

/** Vacuous-pass guard: fewer analyzed files than this means the scan is broken. */
export const MIN_SCANNED = 5;

const FUNCTION_WORDING: Wording = {
  offenderHeading: `function(s) over the cognitive-complexity cap of ${String(MAX_FUNCTION)}`,
  unit: "cognitive",
  list: "complexity",
  fix: "Extract pure, unit-testable helpers; flatten nesting with early returns; replace flag-driven branching with a lookup table or a switch on a union.",
};

const FILE_WORDING: Wording = {
  offenderHeading: `file(s) over the summed cognitive-complexity cap of ${String(MAX_FILE)}`,
  unit: "cognitive",
  list: "complexity",
  fix: "The file cap is a SUM over the file's functions, so extracting a helper in the same file does not help: move a cohesive group of functions into a sibling module.",
};

export type FunctionScore = { name: string; score: number };

/** The metrics of one analyzed file, reduced to what the gate needs. */
export type FileMetrics = { path: string; functions: FunctionScore[] };

const SCORE_PATTERN = /Cognitive Complexity from (\d+) to the/;

/** Reads the score out of a `sonarjs/cognitive-complexity` message. */
export function parseScore(message: string): number {
  const match = SCORE_PATTERN.exec(message);
  if (match?.[1] === undefined) {
    throw new LayoutError(
      `cannot read a cognitive complexity score from the sonarjs message: ${message}`,
    );
  }
  return Number(match[1]);
}

/** Frozen keys for a file's functions: `path::name`, with `#N` appended when a name repeats. */
export function functionKeys(file: FileMetrics): Map<string, number> {
  const totals = new Map<string, number>();
  for (const fn of file.functions) {
    totals.set(fn.name, (totals.get(fn.name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const keys = new Map<string, number>();
  for (const fn of file.functions) {
    const ordinal = (seen.get(fn.name) ?? 0) + 1;
    seen.set(fn.name, ordinal);
    const suffix = (totals.get(fn.name) ?? 0) > 1 ? `#${String(ordinal)}` : "";
    keys.set(`${file.path}::${fn.name}${suffix}`, fn.score);
  }
  return keys;
}

function fileTotal(file: FileMetrics): number {
  return file.functions.reduce((sum, fn) => sum + fn.score, 0);
}

function isFunctionKey(entry: Frozen): boolean {
  return entry.key.includes("::");
}

/** Decides the outcome. Pure. */
export function evaluateComplexity(
  files: FileMetrics[],
  unparsed: string[],
  frozen: Frozen[],
  minScanned: number,
): Report {
  const functions = new Map(files.flatMap((file) => [...functionKeys(file)]));
  const totals = new Map(files.map((file) => [file.path, fileTotal(file)]));
  const report = newReport(
    "ratchet complexity",
    `${String(files.length)} file(s), ${String(functions.size)} scored function(s) analyzed; none over ` +
      `${String(MAX_FUNCTION)} per function or ${String(MAX_FILE)} per file`,
  );
  scanFloor(report, files.length, minScanned);
  pushSection(
    report,
    section(
      "file(s) the parser could not read",
      unparsed,
      "An unparsed file is an unmeasured file. Fix the syntax error; if the file is valid, the parser lags the language.",
    ),
  );
  renderFindings(
    evaluate(functions, MAX_FUNCTION, frozen.filter(isFunctionKey)),
    FUNCTION_WORDING,
    report,
  );
  renderFindings(
    evaluate(
      totals,
      MAX_FILE,
      frozen.filter((entry) => !isFunctionKey(entry)),
    ),
    FILE_WORDING,
    report,
  );
  return report;
}

type Hit = { position: Position; score: number };

/** The innermost function containing `position`. */
function owner(spans: FunctionSpan[], position: Position): FunctionSpan | undefined {
  return spans
    .filter((span) => contains(span, position))
    .sort((a, b) => b.start.line - a.start.line || b.start.column - a.start.column)[0];
}

function toMetrics(path: string, hits: Hit[], spans: FunctionSpan[]): FileMetrics {
  const scored = hits.flatMap((hit) => {
    const span = owner(spans, hit.position);
    return span ? [{ span, score: hit.score }] : [];
  });
  scored.sort(
    (a, b) => a.span.start.line - b.span.start.line || a.span.start.column - b.span.start.column,
  );
  return { path, functions: scored.map(({ span, score }) => ({ name: span.name, score })) };
}

function eslintFor(root: string, spans: Map<string, FunctionSpan[]>): ESLint {
  return new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{ts,tsx,js,mjs}"],
        languageOptions: { parser: tseslint.parser },
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
        plugins: { sonarjs, ratchet: { rules: { functions: collectorRule(spans) } } },
        rules: {
          "sonarjs/cognitive-complexity": ["error", 0],
          "ratchet/functions": "error",
        },
      },
    ],
  });
}

/** Scores every governed file with ESLint. */
export async function measureComplexity(
  repo: Repo,
): Promise<{ files: FileMetrics[]; unparsed: string[] }> {
  const spans = new Map<string, FunctionSpan[]>();
  const paths = repo.files.filter(isGovernedSource);
  const results = await eslintFor(repo.root, spans).lintFiles(paths);
  const files: FileMetrics[] = [];
  const unparsed: string[] = [];
  for (const result of results) {
    const path = relative(repo.root, result.filePath);
    const fatal = result.messages.find((message) => message.fatal === true);
    if (fatal) {
      unparsed.push(`${path}: ${fatal.message}`);
      continue;
    }
    const hits = result.messages
      .filter((message) => message.ruleId === "sonarjs/cognitive-complexity")
      .map((message) => ({
        position: { line: message.line, column: message.column - 1 },
        score: parseScore(message.message),
      }));
    files.push(toMetrics(path, hits, spans.get(result.filePath) ?? []));
  }
  return { files, unparsed };
}

export async function runComplexity(repo: Repo, frozen: Frozen[]): Promise<Report> {
  const { files, unparsed } = await measureComplexity(repo);
  return evaluateComplexity(files, unparsed, frozen, MIN_SCANNED);
}
