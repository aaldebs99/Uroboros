import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

/** The top bar's search: a pill joined to its button. Searches the library (`/?q=`). */
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
      <input
        type="search"
        aria-label="Search your library"
        placeholder="Search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        className="h-10 min-w-0 flex-1 rounded-l-full border border-r-0 border-foreground/22 bg-card px-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
      />
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
