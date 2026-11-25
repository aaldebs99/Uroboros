import { Link } from "@tanstack/react-router";
import { SEARCH_MIN_CHARS, type LibraryKind } from "@uroboros/contract";
import { Download, Library, ListVideo, Music, SearchX } from "lucide-react";

import { errorText } from "@/api/client";
import type { LibraryFilters } from "@/api/library";
import { usePreferences, useUpdatePreferences } from "@/api/preferences";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { notify } from "@/components/ui/sonner";

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

/**
 * What the grid asks for: the view's kind, except in a search, which finds both on either view, and
 * nothing in the person's playlists while they hide those.
 */
function gridFilters(filters: LibraryFilters, kind: LibraryKind, hide: boolean): LibraryFilters {
  return {
    ...filters,
    ...(filters.q === undefined ? { kind } : {}),
    ...(hide ? { inPlaylist: false } : {}),
  };
}

/** The chip that hides what is in the person's playlists, named for the view. */
const HIDE_LABEL: Record<LibraryKind, string> = {
  video: "Hide playlist videos",
  audio: "Hide playlist audio",
};

/** What an empty page says: a filter left nothing, hiding playlist videos did, or there's nothing yet. */
function EmptyLibrary({
  kind,
  narrowed,
  hiding,
}: {
  kind: LibraryKind;
  narrowed: boolean;
  hiding: boolean;
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
        icon={ListVideo}
        title="Nothing outside your playlists."
        action={
          <Button asChild>
            <Link to="/library/playlists">
              <ListVideo aria-hidden />
              Go to Playlists
            </Link>
          </Button>
        }
      >
        {kind === "audio"
          ? "Turn off Hide playlist audio to see all your audio here."
          : "Turn off Hide playlist videos to see every video here."}
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
 * filterable (docs/library.md); a search shows both kinds. The account's Hide playlist videos
 * leaves out what is in their playlists, once it is known.
 */
export function LibraryPage({
  kind = "video",
  filters = {},
  onFilters = () => undefined,
}: {
  kind?: LibraryKind;
  filters?: LibraryFilters;
  /** The route keeps the filters in the URL. */
  onFilters?: (f: LibraryFilters) => void;
}) {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const hide = prefs.data?.hidePlaylistVideos ?? false;
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
          <Chip
            pressed={hide}
            onClick={() => {
              update.mutate(
                { hidePlaylistVideos: !hide },
                {
                  onError: (err) => {
                    notify.error(errorText(err));
                  },
                },
              );
            }}
          >
            {HIDE_LABEL[kind]}
          </Chip>
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
          filters={gridFilters(filters, kind, hide)}
          // A failed read of the preferences counts as off rather than holding the page.
          enabled={!prefs.isPending}
          empty={<EmptyLibrary kind={kind} narrowed={narrowed} hiding={hide} />}
        />
      )}
    </section>
  );
}
