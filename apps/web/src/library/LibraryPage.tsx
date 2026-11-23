import { Link } from "@tanstack/react-router";
import { Download, Library, SearchX } from "lucide-react";

import type { LibraryFilters } from "@/api/library";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

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
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-6">
      <PageHeader title="Library" description="Everything you have downloaded, in one place." />
      <ViewTabs />
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
      <label className="flex items-center gap-2 self-start text-sm text-muted-foreground">
        Sort
        <select
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
          className="h-9 rounded-[10px] border border-foreground/22 bg-card px-3 text-sm text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45 focus-visible:outline-none"
        >
          {(filters.q === undefined
            ? SORTS
            : [{ value: "", label: "Best match" }, ...SORTS.slice(1)]
          ).map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
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
    </section>
  );
}
