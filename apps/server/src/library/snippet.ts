/**
 * Where a search matched, shown as a short line with every term marked (docs/library.md "Search").
 */

export interface SnippetPart {
  text: string;
  mark: boolean;
}

/** Characters kept before the first match, and after it. */
const BEFORE_CHARS = 40;
const AFTER_CHARS = 120;
/** Parts at most, as the contract allows. */
const MAX_PARTS = 64;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** `i`, moved off the second half of a surrogate pair (backwards, or forwards with `up`). */
function whole(text: string, i: number, up = false): number {
  if (i <= 0 || i >= text.length || !isLow(text.charCodeAt(i))) return i;
  return up ? i + 1 : i - 1;
}

/** Every match of every term in `line`, case-insensitively, sorted and overlaps merged. */
function matches(line: string, terms: readonly string[]): [number, number][] {
  const found: [number, number][] = [];
  for (const term of terms) {
    const t = term.trim();
    if (t === "") continue;
    for (const m of line.matchAll(new RegExp(escape(t), "giu"))) {
      found.push([m.index, m.index + m[0].length]);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [s, e] of found) {
    const last = merged.at(-1);
    if (last !== undefined && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/** `line[from, to)` as parts, the matches marked. */
function partsOf(line: string, from: number, to: number, marks: [number, number][]): SnippetPart[] {
  const out: SnippetPart[] = [];
  let at = from;
  for (const [s, e] of marks) {
    if (e <= from || s >= to) continue;
    const [ms, me] = [Math.max(s, from), Math.min(e, to)];
    if (ms > at) out.push({ text: line.slice(at, ms), mark: false });
    out.push({ text: line.slice(ms, me), mark: true });
    at = me;
  }
  if (at < to) out.push({ text: line.slice(at, to), mark: false });
  return out;
}

/** `parts` with an ellipsis before (`head`) or after, joined to the plain text beside it. */
function withEllipses(parts: SnippetPart[], head: boolean, tail: boolean): SnippetPart[] {
  const out = parts.slice(0, MAX_PARTS - 2);
  const first = out[0];
  if (head) {
    if (first !== undefined && !first.mark)
      out[0] = { ...first, text: `…${first.text.trimStart()}` };
    else out.unshift({ text: "…", mark: false });
  }
  const last = out.at(-1);
  if (tail) {
    if (last !== undefined && !last.mark)
      out[out.length - 1] = { ...last, text: `${last.text.trimEnd()}…` };
    else out.push({ text: "…", mark: false });
  }
  return out;
}

/**
 * `text` as one line around its first match of any of `terms`: 40 characters before, 120 after,
 * every match marked, with `…` where it was cut (or where the database had cut it already).
 * `anchor` is where that first match starts in the one-line text (which is `text` itself for a
 * caption run, already one line); with no match there, the start of the text and a null anchor.
 */
export function snippet(
  text: string,
  terms: readonly string[],
  cut: { cutBefore?: boolean; cutAfter?: boolean } = {},
): { parts: SnippetPart[]; anchor: number | null } {
  const line = text
    .split(/\s+/)
    .filter((w) => w !== "")
    .join(" ");
  const marks = matches(line, terms);
  const first = marks[0];
  const from = first === undefined ? 0 : whole(line, Math.max(0, first[0] - BEFORE_CHARS));
  const to =
    first === undefined
      ? whole(line, Math.min(line.length, BEFORE_CHARS + AFTER_CHARS), true)
      : whole(line, Math.min(line.length, first[1] + AFTER_CHARS), true);
  const parts = withEllipses(
    partsOf(line, from, to, marks),
    from > 0 || cut.cutBefore === true,
    to < line.length || cut.cutAfter === true,
  );
  return { parts, anchor: first === undefined ? null : first[0] };
}

/** When the caption line holding `anchor` starts (the run's first line's, with no anchor). */
export function startAt(
  anchor: number | null,
  lineAt: readonly number[],
  lineStart: readonly number[],
): number {
  let i = 0;
  if (anchor !== null) while (i + 1 < lineAt.length && (lineAt[i + 1] ?? Infinity) <= anchor) i++;
  return lineStart[i] ?? 0;
}
