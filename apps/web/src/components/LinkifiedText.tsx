import type { ReactNode } from "react";

/** An http(s) URL up to the next space or markup-ish character. */
const URL_RE = /https?:\/\/[^\s<>"']+/g;
/** Punctuation that ends a sentence rather than the link. */
const TRAILING = /[.,;:!?'"]+$/;

/** Trims what ends the sentence: trailing punctuation, and a ")" the link didn't open. */
function trimEnd(url: string): string {
  let end = url.replace(TRAILING, "");
  while (end.endsWith(")") && (end.match(/\(/g) ?? []).length < (end.match(/\)/g) ?? []).length) {
    end = end.slice(0, -1).replace(TRAILING, "");
  }
  return end;
}

/**
 * Plain text with its http(s) URLs as links, opening in a new tab. Nothing else becomes markup, so
 * text from a site (a video's description) stays text; newlines are left to the paragraph's
 * `whitespace-pre-wrap`.
 */
export function LinkifiedText({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = trimEnd(match[0]);
    if (url.length <= "https://".length) continue;
    const start = match.index;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <a
        key={start}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary [overflow-wrap:anywhere] hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {url}
      </a>,
    );
    at = start + url.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
