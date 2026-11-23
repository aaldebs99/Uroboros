import type { SourceSummary } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { ListVideo } from "lucide-react";

import { errorText } from "@/api/client";
import { useSources } from "@/api/library";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { tileGrid } from "./VideoTile";
import { ViewTabs } from "./ViewTabs";

/** A video tile that looks like a stack, with the count on the thumbnail. */
function PlaylistTile({ source }: { source: SourceSummary }) {
  return (
    <li className="grid gap-3">
      <Link
        to="/library/playlists/$sourceId"
        params={{ sourceId: source.id }}
        className="grid gap-3 rounded-[0.75rem] focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
      >
        <div className="relative pt-4.5">
          <span
            aria-hidden
            className="absolute inset-x-6 top-0 h-3 rounded-t-[0.75rem] bg-raised/60"
          />
          <span
            aria-hidden
            className="absolute inset-x-3 top-1.5 h-3 rounded-t-[0.75rem] bg-raised/85"
          />
          <div className="relative aspect-video overflow-hidden rounded-[0.75rem] bg-raised">
            {source.coverThumbnailUrl === null ? (
              <ListVideo
                className="absolute inset-0 m-auto size-8 text-muted-foreground"
                aria-hidden
              />
            ) : (
              <img
                src={source.coverThumbnailUrl}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            )}
            <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-[0.25rem] bg-overlay px-1.5 py-0.5 text-xs font-medium text-overlay-foreground">
              <ListVideo className="size-3.5" aria-hidden />
              {source.count} videos
            </span>
          </div>
        </div>
        <span className="line-clamp-2 font-medium md:text-[0.9375rem]/[1.3125rem]">
          {source.title ?? "Playlist"}
        </span>
      </Link>
    </li>
  );
}

/** The playlists the person queued. */
export function PlaylistsPage() {
  const sources = useSources();
  const list = sources.data ?? [];
  return (
    <section className="grid w-full gap-6">
      <PageHeader title="Playlists" />
      <ViewTabs />
      {sources.isError ? <p className="text-destructive">{errorText(sources.error)}</p> : null}
      {sources.isSuccess && list.length === 0 ? (
        <EmptyState icon={ListVideo} title="No playlists yet.">
          Playlists you download from show up here.
        </EmptyState>
      ) : (
        <ul className={tileGrid}>
          {list.map((s) => (
            <PlaylistTile key={s.id} source={s} />
          ))}
        </ul>
      )}
    </section>
  );
}
