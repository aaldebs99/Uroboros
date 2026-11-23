import { Search } from "lucide-react";

/** The top bar's search: a pill joined to its button. A placeholder until search exists. */
export function SearchBar() {
  return (
    <form
      role="search"
      className="flex w-full max-w-[640px]"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <input
        aria-label="Search your library"
        placeholder="Search (coming soon)"
        disabled
        className="h-10 min-w-0 flex-1 rounded-l-full border border-r-0 border-foreground/22 bg-card px-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        aria-label="Search"
        disabled
        className="grid h-10 w-16 place-items-center rounded-r-full border border-foreground/22 bg-raised disabled:cursor-not-allowed disabled:text-muted-foreground"
      >
        <Search className="size-5" aria-hidden />
      </button>
    </form>
  );
}
