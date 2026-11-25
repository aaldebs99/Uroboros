import { type LibraryPageEntry, type PreviewEntry, WebLink } from "@uroboros/contract";

/** One row the palette's arrow keys move through and Enter chooses. */
export type PaletteOption =
  | { kind: "entry"; key: string; entry: LibraryPageEntry }
  | { kind: "all"; key: string; query: string }
  | { kind: "youtube"; key: string; query: string }
  | { kind: "result"; key: string; result: PreviewEntry }
  | { kind: "download"; key: string; url: string }
  | { kind: "format"; key: string; url: string };

/** Options under one heading; a null label is the palette's own actions. */
export interface PaletteSection {
  label: string | null;
  options: PaletteOption[];
}

/**
 * How a link typed without `https://` starts: a host with a dot and a letters-only top-level
 * domain, then a path (`twitch.tv/channel`), or a host from `www.`. A word with a dot in it
 * (`node.js`, `youtube.com`) stays words to search for.
 */
const BARE_LINK = /^(?:[^/:]+\.[a-z]{2,}(?::\d+)?\/|www\.[^/:]+\.[a-z]{2,}(?:[:/?#]|$))/i;

/**
 * The text as a link to download (trimmed, `https://` added when it had no scheme), or null when
 * it is words to search for.
 */
export function asLink(text: string): string | null {
  const trimmed = text.trim();
  if (/\s/.test(trimmed) || !(/^https?:\/\//i.test(trimmed) || BARE_LINK.test(trimmed))) {
    return null;
  }
  const link = WebLink.safeParse(trimmed);
  return link.success ? link.data : null;
}

/** What the palette knows so far about the text in its field. */
export interface PaletteState {
  /** The text, trimmed. */
  typed: string;
  /** The library's matches for the words, or for the link (`undefined` until they come back). */
  found: readonly LibraryPageEntry[] | undefined;
  /** YouTube's results for exactly these words, once a search listed them. */
  results: readonly PreviewEntry[] | null;
  /** A YouTube search for these words is under way (or listed them already). */
  searching: boolean;
}

const entryOptions = (entries: readonly LibraryPageEntry[]): PaletteOption[] =>
  entries.map((entry) => ({ kind: "entry", key: `entry-${entry.id}`, entry }));

function linkSections(
  url: string,
  found: readonly LibraryPageEntry[] | undefined,
): PaletteSection[] {
  if (found === undefined) return [];
  if (found.length > 0) return [{ label: "In your library", options: entryOptions(found) }];
  return [
    {
      label: null,
      options: [
        { kind: "download", key: "download", url },
        { kind: "format", key: "format", url },
      ],
    },
  ];
}

function wordSections(s: PaletteState): PaletteSection[] {
  const found = s.found ?? [];
  const sections: PaletteSection[] = [];
  if (found.length > 0) sections.push({ label: "In your library", options: entryOptions(found) });
  const actions: PaletteOption[] = [];
  if (found.length > 0) actions.push({ kind: "all", key: "all", query: s.typed });
  if (!s.searching) actions.push({ kind: "youtube", key: "youtube", query: s.typed });
  if (actions.length > 0) sections.push({ label: null, options: actions });
  if (s.results !== null && s.results.length > 0) {
    sections.push({
      label: "On YouTube",
      options: s.results.map((result) => ({ kind: "result", key: `result-${result.id}`, result })),
    });
  }
  return sections;
}

/**
 * The palette's rows for its text. Words: the library's matches, "See all" (when there are any),
 * "Search YouTube for …" (until that search is under way), then YouTube's results. A link: the
 * library's entries of that video, or else "Download this link" and "Choose a format…".
 */
export function paletteSections(s: PaletteState): PaletteSection[] {
  if (s.typed === "") return [];
  const link = asLink(s.typed);
  return link === null ? wordSections(s) : linkSections(link, s.found);
}
