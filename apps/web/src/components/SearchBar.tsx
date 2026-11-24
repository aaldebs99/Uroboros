import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

import { paletteHint } from "@/lib/shortcuts";

/**
 * The top bar's search: a pill joined to its button. Searches the library (`/?q=`); its hint
 * names the shortcut to the search palette (Ctrl+K, ⌘K on a Mac), which also downloads.
 */
export function SearchBar({ onSearch }: { onSearch?: (q: string) => void }) {
  const navigate = useNavigate();
  const current = useRouterState({
    select: (s) => new URLSearchParams(s.location.searchStr).get("q") ?? "",
  });
  const [text, setText] = useState(current);
  const search =
    onSearch ??
    ((q: string) => {
      void navigate({ href: q === "" ? "/" : `/?q=${encodeURIComponent(q)}` });
    });
  return (
    <form
      role="search"
      className="flex w-full max-w-160"
      onSubmit={(event) => {
        event.preventDefault();
        search(text.trim());
      }}
    >
      <div className="relative flex min-w-0 flex-1">
        <input
          type="search"
          aria-label="Search your library"
          placeholder="Search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          className="h-10 min-w-0 flex-1 rounded-l-full border border-r-0 border-foreground/22 bg-card pr-16 pl-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
        />
        {/* Where the palette is: the hint gives way to whatever is typed. */}
        {text === "" ? (
          <kbd
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-[0.25rem] border border-border bg-raised px-1.5 py-0.5 font-sans text-xs text-muted-foreground"
          >
            {paletteHint()}
          </kbd>
        ) : null}
      </div>
      <button
        type="submit"
        aria-label="Search"
        className="grid h-10 w-16 place-items-center rounded-r-full border border-foreground/22 bg-raised hover:bg-accent focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
      >
        <Search className="size-5" aria-hidden />
      </button>
    </form>
  );
}
