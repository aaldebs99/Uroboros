import type { PlaylistDetail } from "@uroboros/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { Copy, ExternalLink, ListOrdered, Pencil, Play, SearchX, Trash2 } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { useLibraryPages } from "@/api/library";
import {
  copyPlaylist,
  deletePlaylist,
  playlistFilters,
  usePlaylist,
  usePlaylistAction,
} from "@/api/playlists";
import { LinkifiedText } from "@/components/LinkifiedText";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

import { ShareButton } from "../sharing/ShareDialog";
import { LibraryGrid } from "./LibraryGrid";
import { PlaylistDialog } from "./PlaylistDialog";
import { PlaylistEditor } from "./PlaylistEditor";

/** "Play all": the first video, playing the playlist in order (`?list=`). */
function PlayAll({ playlistId, first }: { playlistId: string; first: string | undefined }) {
  if (first === undefined) return null;
  return (
    <Button asChild>
      <Link to="/library/$entryId" params={{ entryId: first }} search={{ list: playlistId }}>
        <Play aria-hidden /> Play all
      </Link>
    </Button>
  );
}

function YouTubeActions({ playlist }: { playlist: PlaylistDetail }) {
  const copy = usePlaylistAction(copyPlaylist);
  const navigate = useNavigate();
  return (
    <>
      <Button
        variant="secondary"
        disabled={copy.isPending}
        onClick={() => {
          copy.mutate(playlist.id, {
            onSuccess: (p) => {
              notify.success(`Saved as your playlist "${p.name}".`);
              void navigate({ to: "/library/playlists/$playlistId", params: { playlistId: p.id } });
            },
            onError: (error) => {
              notify.error(errorText(error));
            },
          });
        }}
      >
        <Copy aria-hidden /> Save as my playlist
      </Button>
      {playlist.url === null ? null : (
        <Button variant="ghost" asChild>
          <a href={playlist.url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> Open on the site
          </a>
        </Button>
      )}
    </>
  );
}

function ManualActions({
  playlist,
  editing,
  onEditing,
}: {
  playlist: PlaylistDetail;
  editing: boolean;
  onEditing: (on: boolean) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const confirm = useConfirm();
  const remove = usePlaylistAction(deletePlaylist);
  const navigate = useNavigate();
  return (
    <>
      <Button
        variant="secondary"
        aria-pressed={editing}
        onClick={() => {
          onEditing(!editing);
        }}
      >
        <ListOrdered aria-hidden /> {editing ? "Done" : "Edit order"}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setRenaming(true);
        }}
      >
        <Pencil aria-hidden /> Rename
      </Button>
      <Button
        variant="destructive"
        onClick={() => {
          confirm.ask({
            title: `Delete "${playlist.name}"?`,
            description: "Its videos stay in your library.",
            confirmLabel: "Delete",
            destructive: true,
            onConfirm: () => {
              remove.mutate(playlist.id, {
                onSuccess: () => void navigate({ to: "/library/playlists" }),
                onError: (error) => {
                  notify.error(errorText(error));
                },
              });
            },
          });
        }}
      >
        <Trash2 aria-hidden /> Delete
      </Button>
      <PlaylistDialog open={renaming} onOpenChange={setRenaming} playlist={playlist} />
      {confirm.dialog}
    </>
  );
}

/** The playlist's videos: tiles, or the editor's rows while reordering a manual one. */
function PlaylistBody({ playlist, editing }: { playlist: PlaylistDetail; editing: boolean }) {
  const filters = playlistFilters(playlist);
  const pages = useLibraryPages(filters);
  if (!editing || playlist.kind !== "manual") {
    return (
      <LibraryGrid
        filters={filters}
        empty={
          <EmptyState icon={SearchX} title="Nothing in this playlist.">
            {playlist.kind === "manual"
              ? "Add videos with Save to playlist on a video."
              : "Its videos may have left your library."}
          </EmptyState>
        }
      />
    );
  }
  return (
    <>
      <PlaylistEditor
        playlistId={playlist.id}
        entries={pages.data?.pages.flatMap((page) => page.entries) ?? []}
      />
      {pages.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** The header's actions: Play all, Share, and the kind's own. */
function PlaylistActions({
  playlist,
  editing,
  onEditing,
}: {
  playlist: PlaylistDetail;
  editing: boolean;
  onEditing: (on: boolean) => void;
}) {
  const pages = useLibraryPages(playlistFilters(playlist));
  return (
    <div className="flex flex-wrap gap-2">
      <PlayAll playlistId={playlist.id} first={pages.data?.pages[0]?.entries[0]?.id} />
      <ShareButton
        kind={playlist.kind === "manual" ? "playlist" : "youtube"}
        id={playlist.id}
        title={playlist.name}
      />
      {playlist.kind === "manual" ? (
        <ManualActions playlist={playlist} editing={editing} onEditing={onEditing} />
      ) : (
        <YouTubeActions playlist={playlist} />
      )}
    </div>
  );
}

const kindLabel = (p: PlaylistDetail) => (p.kind === "youtube" ? "From YouTube" : "Playlist");

/**
 * One playlist, of either kind: its videos in order, Play all, and its own actions. A manual
 * playlist can be reordered, renamed and deleted; a YouTube one saved as a manual copy. Both
 * can be shared (docs/sharing.md).
 */
export function PlaylistPage({ playlistId }: { playlistId: string }) {
  const playlist = usePlaylist(playlistId);
  const [editing, setEditing] = useState(false);
  if (playlist.isError) return <p className="text-destructive">{errorText(playlist.error)}</p>;
  const p = playlist.data;
  return (
    <section className="grid w-full grid-cols-1 gap-6">
      <PageHeader
        showTitle
        title={p?.name ?? "Playlist"}
        description={p === undefined ? undefined : `${kindLabel(p)} · ${String(p.count)} videos`}
        action={
          p === undefined ? undefined : (
            <PlaylistActions playlist={p} editing={editing} onEditing={setEditing} />
          )
        }
      />
      {p?.description ? (
        <p className="whitespace-pre-wrap text-sm">
          <LinkifiedText text={p.description} />
        </p>
      ) : null}
      {p === undefined ? null : <PlaylistBody playlist={p} editing={editing} />}
    </section>
  );
}
