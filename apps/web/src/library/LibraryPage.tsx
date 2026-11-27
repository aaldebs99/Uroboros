import { Link } from "@tanstack/react-router";
import { SEARCH_MIN_CHARS, type LibraryKind } from "@uroboros/contract";
import { Download, Eye, EyeOff, Library, Music, SearchX } from "lucide-react";

import { useChannels, type LibraryFilters } from "@/api/library";
import { usePlaylists } from "@/api/playlists";
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

/** A library view's filters: what the grid asks for, and Show hidden, kept in the URL but never sent. */
export interface LibraryViewFilters extends LibraryFilters {
  showHidden?: true;
}

function without(f: LibraryViewFilters, key: keyof LibraryViewFilters): LibraryViewFilters {
  const { [key]: _gone, ...rest } = f;
  return rest;
}

/**
 * What the grid asks for: the view's kind, and nothing a playlist or a channel hides from the library
 * unless Show hidden is on (docs/library.md "Hiding from the library"); a search finds both kinds,
 * hidden or not.
 */
function gridFilters(
  { showHidden, ...filters }: LibraryViewFilters,
  kind: LibraryKind,
): LibraryFilters {
  if (filters.q !== undefined) return filters;
  return { ...filters, kind, ...(showHidden === true ? {} : { hidden: false }) };
}

/** Whether one of the person's playlists or channels keeps its videos out of the library. */
function useSomeHidden(): boolean {
  const playlists = usePlaylists().data?.some((p) => p.hideFromLibrary) ?? false;
  const channels = useChannels().data?.some((c) => c.hideFromLibrary) ?? false;
  return playlists || channels;
}

/**
 * What an empty page says: a filter left nothing, the playlists and channels that hide their videos
 * hid everything (`hiding`), or there's nothing yet.
 */
function EmptyLibrary({
  kind,
  narrowed,
  hiding,
  onShowHidden,
}: {
  kind: LibraryKind;
  narrowed: boolean;
  hiding: boolean;
  onShowHidden: () => void;
}) {
  if (narrowed) {
    return (
      <EmptyState icon={SearchX} title="Nothing matches.">
        Try other words, or drop a filter.
      </EmptyState>
    );
  }
  if (hiding) {
    return (
      <EmptyState
        icon={EyeOff}
        title="Everything here is hidden by its playlists or channels."
        action={
          <Button onClick={onShowHidden}>
            <Eye aria-hidden />
            {kind === "audio" ? "Show hidden audio" : "Show hidden videos"}
          </Button>
        }
      >
        {kind === "audio"
          ? "A playlist's or channel's Hide from library keeps its audio out of here."
          : "A playlist's or channel's Hide from library keeps its videos out of here."}
      </EmptyState>
    );
  }
  const audio = kind === "audio";
  return (
    <EmptyState
      icon={audio ? Music : Library}
      title={audio ? "No audio yet." : "Nothing here yet."}
      action={
        <Button asChild>
          <Link to="/downloads">
            <Download aria-hidden />
            Go to Downloads
          </Link>
        </Button>
      }
    >
      {audio
        ? "Audio you download with an audio-only profile shows up here."
        : "Videos you download show up here."}
    </EmptyState>
  );
}

/**
 * Library › Videos or Library › Audio: what the person has downloaded of that kind, searchable and
 * filterable (docs/library.md); a search shows both kinds. What a playlist hides from the library
 * stays out unless Show hidden is on, which the chip row offers while one of their playlists hides.
 */
export function LibraryPage({
  kind = "video",
  filters = {},
  onFilters = () => undefined,
}: {
  kind?: LibraryKind;
  filters?: LibraryViewFilters;
  /** The route keeps the filters in the URL. */
  onFilters?: (f: LibraryViewFilters) => void;
}) {
  const someHidden = useSomeHidden();
  const showHidden = filters.showHidden === true;
  const toggleHidden = () => {
    onFilters(showHidden ? without(filters, "showHidden") : { ...filters, showHidden: true });
  };
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
          {someHidden || showHidden ? (
            <Chip pressed={showHidden} onClick={toggleHidden}>
              Show hidden
            </Chip>
          ) : null}
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
          filters={gridFilters(filters, kind)}
          empty={
            <EmptyLibrary
              kind={kind}
              narrowed={narrowed}
              hiding={someHidden && !showHidden}
              onShowHidden={toggleHidden}
            />
          }
        />
      )}
    </section>
  );
}
