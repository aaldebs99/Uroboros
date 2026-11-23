/**
 * `ratchet pixels`: hard-coded pixel values in the web UI may only fall, and the cap is zero.
 *
 * The UI has one size knob, the root font size (`apps/web/src/index.css`: 110% on phones, times
 * `--ui-scale`, the account menu's Size), and every size is rem so the whole UI follows it. A pixel
 * value is a size the knob cannot reach.
 *
 * Counted per governed file (CSS, TS and TSX under `apps/web/src/`, without tests or generated
 * files): every `<number>px` token, in code and comments alike (prose says "a 12-pixel line"),
 * except the exact tokens `0px` and `1px`, hairlines being the one place a pixel is right. A line
 * carrying `px-allow: <reason>`, with a reason longer than `MIN_REASON_CHARS`, is skipped: that is
 * for a value that truly must be device pixels. Files that legitimately need more are frozen in
 * `frozen.json` at their exact count, with a reason. Ported from tyrfing's `xtask ratchet css-px`.
 */
import { frozenReport, MIN_REASON_CHARS, type Frozen, type Wording } from "./frozen.ts";
import { type Report } from "./report.ts";
import { extension, isGenerated, read, type Repo } from "./repo.ts";

/** The web UI's hand-written sources. */
export const ROOT = "apps/web/src/";
const EXTENSIONS = new Set(["css", "ts", "tsx"]);

/**
 * A pixel length: digits (or a leading fraction) then `px`, not part of a longer word or number.
 * `_` and brackets are boundaries, so Tailwind's `shadow-[0_0_12px]` counts.
 */
const PX_TOKEN = /(?<![A-Za-z0-9.])\d*\.?\d+px(?![A-Za-z0-9])/g;

/** Hairlines. Exact tokens only: `10px`, `1.5px` and `01px` all count. */
const ALLOWED = new Set(["0px", "1px"]);

export const MARKER = "px-allow:";

/** Vacuous-pass guard, same meaning as in `lines.ts`. Raise as the UI grows. */
export const MIN_SCANNED = 20;

const WORDING: Wording = {
  offenderHeading: "file(s) with hard-coded pixel values",
  unit: "px",
  list: "pixels",
  fix: "Write rem (px / 16) or a Tailwind spacing step (w-42, size-4.5): the UI scales from one root font size (apps/web/src/index.css). A 1px hairline is fine. A value that truly must be device pixels takes `px-allow: <why, in more than 20 characters>` on its line.",
};

/** Whether `line` carries the marker with a real reason (a trailing comment close is not one). */
function exempt(line: string): boolean {
  const at = line.indexOf(MARKER);
  if (at === -1) {
    return false;
  }
  const reason = line
    .slice(at + MARKER.length)
    .replace(/\*\/\s*\}?\s*$/, "")
    .trim();
  return reason.length > MIN_REASON_CHARS;
}

/** Counts the pixel tokens outside reasoned lines. Pure. */
export function countPixels(content: string): number {
  let count = 0;
  for (const line of content.split("\n")) {
    if (exempt(line)) {
      continue;
    }
    for (const match of line.matchAll(PX_TOKEN)) {
      if (!ALLOWED.has(match[0])) {
        count += 1;
      }
    }
  }
  return count;
}

/** Whether `path` is a web UI source the gate governs. */
export function isGovernedUi(path: string): boolean {
  const ext = extension(path);
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    path.startsWith(ROOT) &&
    ext !== undefined &&
    EXTENSIONS.has(ext) &&
    !isGenerated(path) &&
    !/\.(test|spec)\./.test(name) &&
    !path.split("/").includes("__tests__")
  );
}

/** Per-file pixel counts for every governed file, zeros included. */
export function measurePixels(repo: Repo): Map<string, number> {
  return new Map(
    repo.files
      .filter(isGovernedUi)
      .map((path) => [path, countPixels(read(repo.root, path))] as const),
  );
}

/** Decides the outcome. Pure. */
export function evaluatePixels(
  measured: Map<string, number>,
  frozen: Frozen[],
  minScanned: number,
): Report {
  const total = [...measured.values()].reduce((sum, n) => sum + n, 0);
  return frozenReport(
    "ratchet pixels",
    `${String(measured.size)} file(s) scanned, ${String(total)} hard-coded pixel value(s), all within the baseline`,
    measured,
    0,
    frozen,
    WORDING,
    minScanned,
  );
}

export function runPixels(repo: Repo, frozen: Frozen[]): Report {
  return evaluatePixels(measurePixels(repo), frozen, MIN_SCANNED);
}
