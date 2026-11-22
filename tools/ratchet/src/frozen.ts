/**
 * The shared forward-only ratchet policy: measured values against a cap and a frozen baseline.
 *
 * Every ratchet (lines, complexity, suppressions) reduces to the same question: for each thing
 * measured, is its value within the cap, and if not, is it a known, frozen exception that has not
 * grown? This module answers that once, purely, so each ratchet only owns its collection step and
 * its wording.
 *
 * Outcomes, all failures, none advisory:
 *
 * - offender: over the cap, not frozen
 * - regression: over the cap, frozen, value ABOVE the frozen number
 * - slack: over the cap, frozen, value BELOW the frozen number (update the number)
 * - stale: at or under the cap but still frozen (delete the entry)
 * - unknown: frozen key matches nothing measured (renamed, deleted, not governed)
 * - duplicate: the same key frozen twice
 * - unjustified: a frozen entry whose reason is 20 characters or fewer
 *
 * The only pass for a frozen entry is "over the cap and EXACTLY at its frozen number". Slack is a
 * failure because an entry left at the old number is headroom the code can silently grow back into;
 * stale is a failure because an entry that outlives its fix re-permits the next offender.
 */
import { newReport, pushSection, section, type Report } from "./report.ts";
import { LayoutError, read } from "./repo.ts";

/** Reasons must be longer than this many characters (after trimming). */
export const MIN_REASON_CHARS = 20;

/** One frozen exception: a key (usually a repo-relative path), its frozen value, and why. */
export type Frozen = { key: string; value: number; reason: string };

export type FindingKind =
  | "offender"
  | "regression"
  | "slack"
  | "stale"
  | "unknown"
  | "duplicate"
  | "unjustified";

export type Finding = { kind: FindingKind; key: string; value?: number; frozen?: number };

const KIND_ORDER: FindingKind[] = [
  "offender",
  "regression",
  "slack",
  "stale",
  "unknown",
  "duplicate",
  "unjustified",
];

function classify(key: string, value: number, cap: number, frozen: number | undefined): Finding[] {
  if (frozen === undefined) {
    return value > cap ? [{ kind: "offender", key, value }] : [];
  }
  if (value <= cap) {
    return [{ kind: "stale", key, value, frozen }];
  }
  if (value > frozen) {
    return [{ kind: "regression", key, value, frozen }];
  }
  return value < frozen ? [{ kind: "slack", key, value, frozen }] : [];
}

/** Worst first (value descending), key breaks ties so output is deterministic. */
function byValueThenKey(a: Finding, b: Finding): number {
  return (b.value ?? 0) - (a.value ?? 0) || a.key.localeCompare(b.key);
}

function bookkeeping(frozen: Frozen[], measured: Map<string, number>): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const entry of frozen) {
    if (seen.has(entry.key)) {
      findings.push({ kind: "duplicate", key: entry.key });
    }
    seen.add(entry.key);
    if (entry.reason.trim().length <= MIN_REASON_CHARS) {
      findings.push({ kind: "unjustified", key: entry.key });
    }
    if (!measured.has(entry.key)) {
      findings.push({ kind: "unknown", key: entry.key, frozen: entry.value });
    }
  }
  return findings;
}

/**
 * Applies the ratchet policy. Pure.
 *
 * `measured` must cover EVERY scanned key, not only the ones over the cap: that is what makes
 * `stale` (frozen, present, compliant) distinguishable from `unknown` (frozen, absent).
 */
export function evaluate(measured: Map<string, number>, cap: number, frozen: Frozen[]): Finding[] {
  const table = new Map(frozen.map((entry) => [entry.key, entry.value]));
  const findings = [...measured].flatMap(([key, value]) =>
    classify(key, value, cap, table.get(key)),
  );
  findings.push(...bookkeeping(frozen, measured));
  return findings.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || byValueThenKey(a, b),
  );
}

/** Per-ratchet wording used to turn findings into report sections. */
export type Wording = {
  /** What is measured, for example "source file(s) over the 1000-line cap". */
  offenderHeading: string;
  /** Unit printed after values, for example "lines". */
  unit: string;
  /** Name of the list in frozen.json, for example `lines`. */
  list: string;
  /** How to fix a new offender without adding an exception. */
  fix: string;
};

/** The repo-relative file holding every frozen list. */
export const FROZEN_FILE = "tools/ratchet/frozen.json";

function ofKind(findings: Finding[], kind: FindingKind): Finding[] {
  return findings.filter((f) => f.kind === kind);
}

function valueLine(f: Finding, unit: string): string {
  const frozen = f.frozen === undefined ? "" : `  (frozen at ${String(f.frozen)})`;
  return `${String(f.value ?? 0).padStart(6)} ${unit}  ${f.key}${frozen}`;
}

/** Renders every non-empty category of `findings` into `report`. */
export function renderFindings(findings: Finding[], wording: Wording, report: Report): void {
  const { unit, list } = wording;
  const where = `\`${list}\` in ${FROZEN_FILE}`;
  const lines = (kind: FindingKind): string[] =>
    ofKind(findings, kind).map((f) => valueLine(f, unit));
  const keys = (kind: FindingKind): string[] => ofKind(findings, kind).map((f) => f.key);
  pushSection(
    report,
    section(
      wording.offenderHeading,
      lines("offender"),
      `${wording.fix}\nOnly if an exception is genuinely right: add { "key", "value", "reason" } to ${where} ` +
        `with the exact current value and a reason longer than ${String(MIN_REASON_CHARS)} characters.`,
    ),
  );
  pushSection(
    report,
    section(
      "frozen entr(y/ies) grew past the frozen number (regression)",
      lines("regression"),
      `Bring each back down to at most its frozen number. Do not raise the number in ${where}: ` +
        `the ratchet only moves toward the cap.\n${wording.fix}`,
    ),
  );
  pushSection(
    report,
    section(
      "frozen entr(y/ies) improved but the frozen number was not lowered (slack)",
      lines("slack"),
      `Nice work, now lock it in: update the frozen number in ${where} to the new value shown ` +
        "above, in the same commit. Otherwise the code can grow back into the headroom with this gate printing clean.",
    ),
  );
  pushSection(
    report,
    section(
      "frozen entr(y/ies) now within the cap (stale)",
      lines("stale"),
      `Delete these entries from ${where}. An exception that outlives its fix silently ` +
        "re-permits the next offender at that key.",
    ),
  );
  pushSection(
    report,
    section(
      "frozen entr(y/ies) match nothing that was measured (unknown)",
      keys("unknown"),
      `The key was renamed, deleted, or is not governed by this ratchet. Delete or repoint the ` +
        `entry in ${where}; as written it protects nothing.`,
    ),
  );
  pushSection(
    report,
    section(
      "key(s) frozen more than once",
      keys("duplicate"),
      `Keep exactly one entry per key in ${where}.`,
    ),
  );
  pushSection(
    report,
    section(
      "frozen entr(y/ies) without a real reason",
      keys("unjustified"),
      `Every entry in ${where} needs a reason longer than ${String(MIN_REASON_CHARS)} characters ` +
        "saying why the exception is right and what would remove it.",
    ),
  );
}

/** A section that fails when a scan found suspiciously few files (the vacuous-pass guard). */
export function scanFloor(report: Report, scanned: number, minScanned: number): void {
  const items =
    scanned < minScanned
      ? [`scanned ${String(scanned)} governed file(s), expected at least ${String(minScanned)}`]
      : [];
  pushSection(
    report,
    section(
      "scan(s) found too few files to be trusted (vacuous-pass guard)",
      items,
      "The scan is broken (wrong repository root, broken `git ls-files`), not the tree clean. " +
        "Fix the scan; lower the floor only if files were genuinely removed.",
    ),
  );
}

/** Builds a report, applies the floor and the frozen policy. Shared by lines and suppressions. */
export function frozenReport(
  gate: string,
  summary: string,
  measured: Map<string, number>,
  cap: number,
  frozen: Frozen[],
  wording: Wording,
  minScanned: number,
): Report {
  const report = newReport(gate, summary);
  scanFloor(report, measured.size, minScanned);
  renderFindings(evaluate(measured, cap, frozen), wording, report);
  return report;
}

/** The three frozen lists in `tools/ratchet/frozen.json`. */
export type FrozenLists = { lines: Frozen[]; complexity: Frozen[]; suppressions: Frozen[] };

function isEntry(value: unknown): value is Frozen {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["key"] === "string" &&
    typeof entry["value"] === "number" &&
    typeof entry["reason"] === "string"
  );
}

function entries(doc: Record<string, unknown>, name: keyof FrozenLists): Frozen[] {
  const list = doc[name];
  if (!Array.isArray(list) || !list.every(isEntry)) {
    throw new LayoutError(
      `${FROZEN_FILE} "${name}" must be an array of { "key": string, "value": number, "reason": string }`,
    );
  }
  return list;
}

/** Parses `frozen.json`. A missing file or a wrong shape is a layout error, never an empty list. */
export function parseFrozen(text: string): FrozenLists {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new LayoutError(
      `cannot parse ${FROZEN_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new LayoutError(`${FROZEN_FILE} must be a JSON object`);
  }
  const record = doc as Record<string, unknown>;
  return {
    lines: entries(record, "lines"),
    complexity: entries(record, "complexity"),
    suppressions: entries(record, "suppressions"),
  };
}

export function loadFrozen(root: string): FrozenLists {
  return parseFrozen(read(root, FROZEN_FILE));
}
