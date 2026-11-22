/**
 * `ratchet lines`: no governed source file may exceed 1000 physical lines.
 *
 * Length is not quality, but it is a proxy for how much has to be held in the head at once to
 * change a file safely. The cap is a forcing function for extraction toward pure, unit-testable
 * helpers.
 *
 * Lines are physical: comments and blank lines count, so a counter with no comment-scrubbing
 * states cannot quietly under-count. The same scan also fails any governed file containing a NUL
 * byte: git then treats it as binary and it silently drops out of every diff and review. That is
 * never exceptable.
 */
import { frozenReport, type Frozen, type Wording } from "./frozen.ts";
import { pushSection, section, type Report } from "./report.ts";
import { isGovernedSource, read, type Repo } from "./repo.ts";

/** Hard cap on physical lines per governed file. Inclusive. */
export const MAX_LINES = 1000;

/**
 * Vacuous-pass guard: a scan that finds fewer governed files than this is a broken scan (wrong
 * root, broken git listing), not a clean tree. Raise it as the repo grows.
 */
export const MIN_SCANNED = 10;

const WORDING: Wording = {
  offenderHeading: `source file(s) over the ${String(MAX_LINES)}-line cap`,
  unit: "lines",
  list: "lines",
  fix: "Extract pure, unit-testable helpers (or split the module into siblings) rather than adding an exception.",
};

export type FileScan = {
  path: string;
  lines: number;
  /** 1-based line of the first NUL byte, if any. */
  nulAt?: number;
};

/** Physical line count: a final line without a trailing newline still counts. */
export function countLines(content: string): number {
  if (content === "") {
    return 0;
  }
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

/** Measures one file's content. Pure. */
export function scanContent(path: string, content: string): FileScan {
  const nul = content.indexOf("\0");
  const scan: FileScan = { path, lines: countLines(content) };
  if (nul >= 0) {
    scan.nulAt = content.slice(0, nul).split("\n").length;
  }
  return scan;
}

/** Decides the outcome. Pure: no filesystem, no git. */
export function evaluateLines(scans: FileScan[], frozen: Frozen[], minScanned: number): Report {
  const measured = new Map(scans.map((s) => [s.path, s.lines]));
  const report = frozenReport(
    "ratchet lines",
    `${String(scans.length)} source file(s) scanned, none over the ${String(MAX_LINES)}-line cap`,
    measured,
    MAX_LINES,
    frozen,
    WORDING,
    minScanned,
  );
  const nul = scans.flatMap((s) =>
    s.nulAt === undefined ? [] : [`line ${String(s.nulAt).padStart(5)}  ${s.path}`],
  );
  pushSection(
    report,
    section(
      "source file(s) contain a NUL byte, so git treats them as binary",
      nul,
      "The file still compiles, but `git diff` and pull requests show no patch, so it cannot be " +
        "reviewed. Remove the byte (use an escape such as `\\0` in string literals). There is no exception for this.",
    ),
  );
  return report;
}

/** Reads and scans every governed file. */
export function measureLines(repo: Repo): FileScan[] {
  return repo.files
    .filter(isGovernedSource)
    .map((path) => scanContent(path, read(repo.root, path)));
}

export function runLines(repo: Repo, frozen: Frozen[]): Report {
  return evaluateLines(measureLines(repo), frozen, MIN_SCANNED);
}
