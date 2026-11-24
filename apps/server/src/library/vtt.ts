/**
 * WebVTT captions as timed text segments for search (docs/library.md "Search"). Pure, and it never
 * throws: a file it cannot read yields fewer segments, or none.
 */

/** A run of caption lines: `lineAt` is where each line begins in `text` and `lineStart` when. */
export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
  lineAt: number[];
  lineStart: number[];
}

/** One caption line, on screen from `start` until `end` (stretched while later cues repeat it). */
interface Line {
  text: string;
  start: number;
  end: number;
}

interface Cue {
  start: number;
  end: number;
  lines: string[];
}

/** A segment closes before its text passes this many characters… */
const SEGMENT_CHARS = 240;
/** …or before it spans more than this many seconds… */
const SEGMENT_SECONDS = 30;
/** …and a silence this long starts a new one. */
const GAP_SECONDS = 5;
/** The longest segment text; a longer line is split at word boundaries. */
const MAX_LINE_CHARS = 400;

const TIME = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/;

function seconds(stamp: string): number | null {
  const m = TIME.exec(stamp);
  if (m === null) return null;
  const [, h, mm, ss, ms] = m;
  const min = Number(mm);
  const sec = Number(ss);
  if (min > 59 || sec > 59) return null;
  return Number(h ?? 0) * 3600 + min * 60 + sec + Number(ms) / 1000;
}

/** `start --> end [settings]`, or null. */
function timings(line: string): { start: number; end: number } | null {
  const [left, right] = line.split("-->");
  if (left === undefined || right === undefined) return null;
  const start = seconds(left.trim());
  const end = seconds(right.trim().split(/\s+/)[0] ?? "");
  if (start === null || end === null) return null;
  return { start, end: Math.max(start, end) };
}

const SKIPPED_BLOCK = /^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/;

/** The cues of a file: blocks end only at a zero-length line (YouTube's payloads hold " " lines). */
function cues(vtt: string): Cue[] {
  const blocks = vtt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\n+/);
  const out: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (SKIPPED_BLOCK.test(lines[0] ?? "")) continue;
    const at = lines.findIndex((l) => l.includes("-->"));
    // The timing line is the first line, or the second after a cue id.
    if (at < 0 || at > 1) continue;
    const t = timings(lines[at] ?? "");
    if (t === null) continue;
    out.push({ ...t, lines: lines.slice(at + 1) });
  }
  return out;
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
};

function codePoint(n: number): string {
  const valid = Number.isInteger(n) && n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff);
  return valid ? String.fromCodePoint(n) : "";
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X"))
      return codePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return codePoint(Number(name.slice(1)));
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

/** Only sound tags, notes or punctuation: no words to find. */
const WORDLESS = /^(?:\[[^\]]*\]|[\s\p{P}\p{S}])*$/u;
// eslint-disable-next-line no-control-regex -- control characters are what it removes
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** The words of a payload line: no tags or inline timestamps, entities decoded, one line. */
export function cleanLine(raw: string): string {
  const text = decode(raw.replace(/<[^>]*>/g, ""))
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    // YouTube's speaker change.
    .replace(/^(?:>>\s*)+/, "");
  return WORDLESS.test(text) ? "" : text;
}

/**
 * Each line once, from the cue that brought it: a line the previous cue showed (YouTube's rolling
 * captions repeat the last line, and 10 ms cues repeat everything) stretches that line instead.
 */
function linesOf(all: Cue[]): Line[] {
  const out: Line[] = [];
  let shown = new Map<string, Line>();
  for (const c of all) {
    const now = new Map<string, Line>();
    for (const text of c.lines.map(cleanLine)) {
      if (text === "") continue;
      const last = out.at(-1);
      const same = shown.get(text) ?? (last?.text === text ? last : undefined);
      if (same !== undefined) {
        same.end = Math.max(same.end, c.end);
        now.set(text, same);
        continue;
      }
      const line = { text, start: c.start, end: c.end };
      out.push(line);
      now.set(text, line);
    }
    shown = now;
  }
  return out;
}

/** `line` in pieces of at most `MAX_LINE_CHARS` characters, cut between words where it can be. */
function pieces(line: Line): Line[] {
  const chars = Array.from(line.text);
  if (chars.length <= MAX_LINE_CHARS) return [line];
  const out: Line[] = [];
  let rest = chars;
  while (rest.length > MAX_LINE_CHARS) {
    const space = rest.lastIndexOf(" ", MAX_LINE_CHARS);
    const cut = space > 0 ? space : MAX_LINE_CHARS;
    out.push({ ...line, text: rest.slice(0, cut).join("") });
    rest = rest.slice(space > 0 ? cut + 1 : cut);
  }
  if (rest.length > 0) out.push({ ...line, text: rest.join("") });
  return out;
}

function fits(s: CaptionSegment, line: Line): boolean {
  return (
    s.text.length + 1 + line.text.length <= SEGMENT_CHARS &&
    line.start - s.start <= SEGMENT_SECONDS &&
    line.start - s.end < GAP_SECONDS
  );
}

/** The captions of a WebVTT file as segments, at most `maxSegments` of them. */
export function parseVtt(vtt: string, maxSegments = 5000): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  let open: CaptionSegment | null = null;
  for (const line of linesOf(cues(vtt)).flatMap(pieces)) {
    if (open !== null && fits(open, line)) {
      open.lineAt.push(open.text.length + 1);
      open.lineStart.push(line.start);
      open.text = `${open.text} ${line.text}`;
      open.end = Math.max(open.end, line.end);
      continue;
    }
    if (out.length === maxSegments) break;
    open = {
      start: line.start,
      end: line.end,
      text: line.text,
      lineAt: [0],
      lineStart: [line.start],
    };
    out.push(open);
  }
  return out;
}
