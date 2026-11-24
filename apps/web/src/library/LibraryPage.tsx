import { Link } from "@tanstack/react-router";
import { SEARCH_MIN_CHARS } from "@uroboros/contract";
import { Download, Library, SearchX } from "lucide-react";

import type { LibraryFilters } from "@/api/library";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";

import { Chip, ChipRow, FilterChip } from "./Chips";
import { LibraryGrid } from "./LibraryGrid";
import { ViewTabs } from "./ViewTabs";

const SORTS = [
  { value: "", label: "Newest first" },
  { value: "uploaded", label: "Upload date" },
  { value: "title", label: "Title" },
  { value: "duration", label: "Longest first" },
] as const;

const WATCHED = [
  { label: "All", value: undefined },
  { label: "Unwatched", value: false },
  { label: "Watched", value: true },
] as const;

function without(f: LibraryFilters, key: keyof LibraryFilters): LibraryFilters {
  const { [key]: _gone, ...rest } = f;
  return rest;
}

/** Library: everything the person has downloaded, searchable and filterable (docs/library.md). */
export function LibraryPage({
  filters = {},
  onFilters = () => undefined,
}: {
  filters?: LibraryFilters;
  /** The route keeps the filters in the URL. */
  onFilters?: (f: LibraryFilters) => void;
}) {
  const narrowed =
    filters.q !== undefined || filters.tag !== undefined || filters.watched !== undefined;
  // The server searches only from 3 characters (docs/library.md "Search"): fewer is not sent.
  const tooShort =
    filters.q !== undefined && Array.from(filters.q.trim()).length < SEARCH_MIN_CHARS;
  return (
    <section className="grid w-full grid-cols-1 gap-6">
      <PageHeader title="Library" />
      <ViewTabs />
      {/* The sort sits at the end of the chips' row; on phones the chips scroll beside it. */}
      <div className="flex items-center gap-3">
        <ChipRow>
          {WATCHED.map((w) => (
            <Chip
              key={w.label}
              pressed={filters.watched === w.value}
              onClick={() => {
                onFilters(
                  w.value === undefined
                    ? without(filters, "watched")
                    : { ...filters, watched: w.value },
                );
              }}
            >
              {w.label}
            </Chip>
          ))}
          {filters.q === undefined ? null : (
            <FilterChip
              label={`“${filters.q}”`}
              onRemove={() => {
                onFilters(without(filters, "q"));
              }}
            />
          )}
          {filters.tag === undefined ? null : (
            <FilterChip
              label={filters.tag}
              onRemove={() => {
                onFilters(without(filters, "tag"));
              }}
            />
          )}
        </ChipRow>
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="max-md:sr-only">Sort</span>
          <Select
            compact
            aria-label="Sort"
            value={filters.sort ?? ""}
            onChange={(e) => {
              const sort = e.target.value;
              onFilters(
                sort === ""
                  ? without(filters, "sort")
                  : { ...filters, sort: sort as NonNullable<LibraryFilters["sort"]> },
              );
            }}
          >
            {(filters.q === undefined
              ? SORTS
              : [{ value: "", label: "Best match" }, ...SORTS.slice(1)]
            ).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {tooShort ? (
        <EmptyState icon={SearchX} title={`Type at least ${String(SEARCH_MIN_CHARS)} characters.`}>
          Search finds words in titles, channels, chapters, descriptions and captions.
        </EmptyState>
      ) : (
        <LibraryGrid
          filters={filters}
          empty={
            narrowed ? (
              <EmptyState icon={SearchX} title="Nothing matches.">
                Try other words, or drop a filter.
              </EmptyState>
            ) : (
              <EmptyState
                icon={Library}
                title="Nothing here yet."
                action={
                  <Button asChild>
                    <Link to="/downloads">
                      <Download aria-hidden />
                      Go to Downloads
                    </Link>
                  </Button>
                }
              >
                Videos you download show up here.
              </EmptyState>
            )
          }
        />
      )}
    </section>
  );
}
