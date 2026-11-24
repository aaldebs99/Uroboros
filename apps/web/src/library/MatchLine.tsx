import type { SearchMatch } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";

import { formatDuration } from "@/downloads/format";
import { cn } from "@/lib/utils";

/** "Chapter · 1:00", "Description" or "Captions · 0:30": where a search matched. */
export function matchLabel(match: SearchMatch): string {
  const at = match.start === null ? "" : ` · ${formatDuration(match.start)}`;
  switch (match.in) {
    case "chapter":
      return `Chapter${at}`;
    case "description":
      return "Description";
    case "captions":
      return `Captions${at}`;
  }
}

/** The words around a match, the searched ones marked. */
export function MatchSnippet({ match }: { match: SearchMatch }) {
  return (
    <>
      {match.snippet.map((part, i) =>
        part.mark ? (
          <mark key={i} className="rounded-[0.125rem] bg-accent text-accent-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Where a search matched, under a tile's details (docs/library.md "Search"): a muted line with the
 * place and the words around it. A chapter or caption match links to its moment (`?t=`); the
 * tile's own thumbnail and title still resume where the person left off.
 */
export function MatchLine({
  entryId,
  match,
  className,
}: {
  entryId: string;
  match: SearchMatch;
  className?: string;
}) {
  const body = (
    <>
      <span className="font-medium">{matchLabel(match)}</span> · <MatchSnippet match={match} />
    </>
  );
  const line = cn("line-clamp-2", className);
  return match.start === null ? (
    <p className={line}>{body}</p>
  ) : (
    <Link
      to="/library/$entryId"
      params={{ entryId }}
      search={{ t: Math.floor(match.start) }}
      className={cn(
        line,
        "hover:text-foreground hover:underline focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none",
      )}
    >
      {body}
    </Link>
  );
}
