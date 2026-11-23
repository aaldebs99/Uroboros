import type { PlaylistSummary } from "@uroboros/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { ListVideo, Plus } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { usePlaylists } from "@/api/playlists";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { PlaylistDialog } from "./PlaylistDialog";
import { tileGrid } from "./VideoTile";
import { ViewTabs } from "./ViewTabs";

/** A video tile that looks like a stack, with the count on the thumbnail. */
function PlaylistTile({ source }: { source: PlaylistSummary }) {
  return (
    <li className="grid gap-3">
      <Link
        to="/library/playlists/$playlistId"
        params={{ playlistId: source.id }}
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
        <span className="grid gap-0.5">
          <span className="line-clamp-2 font-medium md:text-[0.9375rem]/[1.3125rem]">
            {source.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {source.kind === "youtube" ? "From YouTube" : "Playlist"} · {source.count} videos
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The person's playlists: the ones they made, then the ones from YouTube. */
export function PlaylistsPage() {
  const playlists = usePlaylists();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const list = playlists.data ?? [];
  return (
    <section className="grid w-full grid-cols-1 gap-6">
      <PageHeader
        title="Playlists"
        action={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden /> New playlist
          </Button>
        }
      />
      <ViewTabs />
      {playlists.isError ? <p className="text-destructive">{errorText(playlists.error)}</p> : null}
      {playlists.isSuccess && list.length === 0 ? (
        <EmptyState icon={ListVideo} title="No playlists yet.">
          Make one, or download a YouTube playlist and it shows up here.
        </EmptyState>
      ) : (
        <ul className={tileGrid}>
          {list.map((s) => (
            <PlaylistTile key={s.id} source={s} />
          ))}
        </ul>
      )}
      <PlaylistDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(p) => {
          void navigate({ to: "/library/playlists/$playlistId", params: { playlistId: p.id } });
        }}
      />
    </section>
  );
}
