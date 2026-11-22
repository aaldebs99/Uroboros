/**
 * The one output shape every gate produces.
 *
 * A gate collects (I/O), evaluates (pure) and returns a `Report`. `main` turns the report into
 * text and an exit code. Every gate explains its failures the same way: a heading per failure
 * category, the offending items, and a paragraph telling the developer what to do next.
 */

/** One failure category inside a report, such as "new offenders" or "stale exceptions". */
export type Section = {
  /** One-line description of what went wrong, without the count (the renderer adds it). */
  heading: string;
  /** The offending items, one per line, already formatted. */
  items: string[];
  /** What the developer should do about it. Actionable, not descriptive. */
  advice: string;
};

export type Report = {
  /** Gate name as the developer typed it, for example `ratchet lines`. */
  gate: string;
  /**
   * Printed on success only, so a pass is not silent about its scope. Summaries assert success
   * ("none over the cap"), so the failure verdict deliberately omits them.
   */
  summary: string;
  /** Informational lines printed after the success summary (for example a skipped check). */
  notes: string[];
  /** Failure categories. Empty means the gate passed. */
  sections: Section[];
};

export function newReport(gate: string, summary: string): Report {
  return { gate, summary, notes: [], sections: [] };
}

/** Adds the section only when it has items, so callers can push every category unconditionally. */
export function pushSection(report: Report, section: Section): void {
  if (section.items.length > 0) {
    report.sections.push(section);
  }
}

export function section(heading: string, items: string[], advice: string): Section {
  return { heading, items, advice };
}

export function isOk(report: Report): boolean {
  return report.sections.length === 0;
}

export function problemCount(report: Report): number {
  return report.sections.reduce((total, s) => total + s.items.length, 0);
}

/** The success text (stdout). */
export function renderOk(report: Report): string {
  const notes = report.notes.map((note) => `  note: ${note}\n`).join("");
  return `${report.gate}: ok — ${report.summary}\n${notes}`;
}

/**
 * The full failure listing (stderr). Ends with a one-line verdict so the last line of a CI log
 * says what failed.
 */
export function renderFailure(report: Report): string {
  let out = "";
  for (const s of report.sections) {
    out += `${String(s.items.length)} ${s.heading}:\n`;
    for (const item of s.items) {
      out += `  ${item}\n`;
    }
    out += "\n";
    for (const line of s.advice.split("\n")) {
      out += `  → ${line}\n`;
    }
    out += "\n";
  }
  out += `${report.gate}: FAILED — ${String(problemCount(report))} problem(s)\n`;
  return out;
}
