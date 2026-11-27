import type { ClipRange, LibraryItem } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ListVideo, SearchX, Share2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ApiError, errorText } from "@/api/client";
import { itemKey, reportProgress, setTags, useItem } from "@/api/library";
import { useSponsorColors } from "@/api/preferences";
import { LinkifiedText } from "@/components/LinkifiedText";
import { EmptyState } from "@/components/ui/empty-state";
import { notify } from "@/components/ui/sonner";
import { formatDuration } from "@/downloads/format";

import { ItemActions } from "./ItemActions";
import { Suggestions } from "./Suggestions";
import { TagEditor } from "./TagEditor";
import { nextInQueue, UpNext, useQueue, type PlayQueue } from "./UpNext";
import { usePickedClip } from "./usePickedClip";
import { useProgressReporter } from "./useProgressReporter";
import { useQuietSkipsRefresh } from "./useQuietSkipsRefresh";
import { WatchBack } from "./WatchBack";
import { PlayerPlaceholder, WatchPlayer } from "./WatchPlayer";

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[0.75rem] bg-raised p-3 text-sm">
      <p className={open ? "whitespace-pre-wrap" : "line-clamp-3 whitespace-pre-wrap"}>
        <LinkifiedText text={text} />
      </p>
      <button
        type="button"
        className="mt-1 font-medium hover:underline"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? "less" : "more"}
      </button>
    </div>
  );
}

function Chapters({ item, onSeek }: { item: LibraryItem; onSeek: (time: number) => void }) {
  if (item.chapters.length === 0) return null;
  return (
    <section aria-label="Chapters" className="grid gap-1">
      <h2 className="text-base font-bold">Chapters</h2>
      <ol className="grid gap-0.5">
        {item.chapters.map((c, i) => (
          <li key={`${String(c.start)}-${String(i)}`}>
            <button
              type="button"
              onClick={() => {
                onSeek(c.start);
              }}
              className="flex w-full items-center gap-3 rounded-[0.625rem] px-2 py-2 text-left hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
            >
              <span className="w-14 text-xs text-primary tabular-nums">
                {formatDuration(c.start)}
              </span>
              <span className="truncate">{c.title ?? `Chapter ${String(i + 1)}`}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A watch page whose video cannot be shown: a share that ended (reached through a shared
 * playlist, or last seen as shared) says so; anything else not found says it is not available.
 */
function Unavailable({ error, shared }: { error: unknown; shared: boolean }) {
  if (!(error instanceof ApiError) || error.status !== 404) {
    return <p className="text-destructive">{errorText(error)}</p>;
  }
  return shared ? (
    <EmptyState icon={Share2} title="This is no longer shared with you">
      Whoever shared it stopped, or removed the video.
    </EmptyState>
  ) : (
    <EmptyState icon={SearchX} title="This video isn't available">
      It may have been removed from your library, or is no longer shared with you.
    </EmptyState>
  );
}

/** The playlists this video is in: the person's own, then YouTube ones. */
function InPlaylists({ item }: { item: LibraryItem }) {
  const all = [
    ...item.playlists.map((p) => ({ id: p.id, name: p.name })),
    ...item.sources.map((s) => ({ id: s.id, name: s.title ?? "a playlist" })),
  ];
  if (all.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <ListVideo className="size-4" aria-hidden /> In
      {all.map((p) => (
        <Link
          key={p.id}
          to="/library/playlists/$playlistId"
          params={{ playlistId: p.id }}
          className="text-primary hover:underline"
        >
          {p.name}
        </Link>
      ))}
    </p>
  );
}

/** Every state of a watch page, its back link above (`WatchBack`). */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="@container grid w-full content-start gap-6">
      <WatchBack />
      {children}
    </div>
  );
}

/**
 * One video, laid out like a watch page across the whole page: the player at the top left with its
 * details, description, tags and chapters below it, and suggestions in a column on the right. The
 * side navigation is a drawer here (the shell); the player takes 65% of the page and the
 * suggestions the rest (at least 18rem). The columns follow the width the page has (a container
 * query), not the window: a narrow page stacks the suggestions under the details.
 */
export function ItemPage({
  entryId,
  queue = null,
  startAt = null,
  range,
}: {
  entryId: string;
  queue?: PlayQueue | null;
  /** Where to start (a search match's moment, `?t=`), over where the person left off. */
  startAt?: number | null;
  /** A clip a link opens the whole video at (`?t=&end=`): drawn, paused at its end. */
  range?: ClipRange | null;
}) {
  const item = useItem(entryId);
  const picked = usePickedClip(entryId, range);
  const colors = useSponsorColors();
  const client = useQueryClient();
  const [seek, setSeek] = useState<{ time: number; pause?: boolean } | null>(null);
  const navigate = useNavigate();
  const q = useQueue(queue);
  const reporter = useProgressReporter((position, duration) =>
    reportProgress(entryId, position, duration),
  );
  useQuietSkipsRefresh(entryId, item.data);
  if (item.isError)
    return (
      <Frame>
        <Unavailable
          error={item.error}
          shared={queue?.kind === "share" || item.data?.sharedBy != null}
        />
      </Frame>
    );
  if (item.isPending)
    return (
      <Frame>
        <PlayerPlaceholder />
      </Frame>
    );
  const it = item.data;
  const refresh = () => client.invalidateQueries({ queryKey: ["api", "library"] });
  const fail = (err: unknown) => {
    notify.error(errorText(err));
  };
  // In a queue, the end of a video moves on to the next one.
  const onEnded = (position: number, duration: number) => {
    reporter.onEnded(position, duration);
    if (q === null) return;
    void nextInQueue(q, entryId).then((next) => {
      if (next !== null) {
        void navigate({ to: "/library/$entryId", params: { entryId: next }, search: q.search });
      }
    });
  };
  return (
    <Frame>
      <div className="grid gap-6 @6xl:grid-cols-[minmax(0,13fr)_minmax(18rem,7fr)]">
        <article className="grid min-w-0 content-start gap-4">
          <WatchPlayer
            key={`${it.id}@${String(startAt)}`}
            item={it}
            start={
              startAt ?? (it.progress !== null && !it.progress.watched ? it.progress.position : 0)
            }
            autoPlay
            seek={seek}
            sponsorColors={colors}
            {...reporter}
            onEnded={onEnded}
            clip={picked.control}
            range={picked.shown}
          />
          <h1 className="text-xl font-bold">{it.title}</h1>
          <ItemActions
            item={it}
            clip={picked.clip}
            onStartOver={() => {
              setSeek({ time: 0, pause: true });
            }}
          />
          {it.description === null || it.description.trim() === "" ? null : (
            <Description text={it.description} />
          )}
          {it.sharedBy !== null ? null : (
            <TagEditor
              tags={it.tags}
              onChange={(tags) => {
                setTags(entryId, tags)
                  .then(() => client.invalidateQueries({ queryKey: itemKey(entryId) }))
                  .then(refresh)
                  .catch(fail);
              }}
            />
          )}
          <InPlaylists item={it} />
          <Chapters
            item={it}
            onSeek={(time) => {
              setSeek({ time });
            }}
          />
        </article>
        {q === null ? (
          <aside aria-label="Suggestions" className="min-w-0">
            <Suggestions currentId={entryId} />
          </aside>
        ) : (
          <aside aria-label="Up next" className="min-w-0">
            <UpNext queue={q} currentId={entryId} />
          </aside>
        )}
      </div>
    </Frame>
  );
}
