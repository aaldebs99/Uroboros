import type { LibraryItem } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, ExternalLink, ListVideo, Trash2 } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import {
  itemKey,
  reportProgress,
  setTags,
  setKept,
  setWatched,
  useItem,
  useRemoveEntry,
} from "@/api/library";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { formatDuration } from "@/downloads/format";

import { Suggestions } from "./Suggestions";
import { TagEditor } from "./TagEditor";
import { useProgressReporter } from "./useProgressReporter";
import { WatchPlayer } from "./WatchPlayer";

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[0.75rem] bg-raised p-3 text-sm">
      <p className={open ? "whitespace-pre-wrap" : "line-clamp-3 whitespace-pre-wrap"}>{text}</p>
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
 * One video, laid out like a watch page across the whole page: the player at the top left with its
 * details, description, tags and chapters below it, and suggestions in a column on the right. The
 * side navigation is a drawer here (the shell); the player takes 65% of the page and the
 * suggestions the rest (at least 18rem). The columns follow the width the page has (a container
 * query), not the window: a narrow page stacks the suggestions under the details.
 */
export function ItemPage({ entryId }: { entryId: string }) {
  const item = useItem(entryId);
  const client = useQueryClient();
  const [seek, setSeek] = useState<{ time: number } | null>(null);
  const confirm = useConfirm();
  const remove = useRemoveEntry();
  const navigate = useNavigate();
  const reporter = useProgressReporter((position, duration) =>
    reportProgress(entryId, position, duration),
  );
  if (item.isError) return <p className="text-destructive">{errorText(item.error)}</p>;
  if (item.isPending)
    return <div aria-busy="true" className="aspect-video w-full rounded-[0.75rem] bg-raised" />;
  const it = item.data;
  const refresh = () => client.invalidateQueries({ queryKey: ["api", "library"] });
  const fail = (err: unknown) => {
    notify.error(errorText(err));
  };
  return (
    <div className="@container w-full">
      <div className="grid gap-6 @6xl:grid-cols-[minmax(0,13fr)_minmax(18rem,7fr)]">
        <article className="grid min-w-0 content-start gap-4">
          <WatchPlayer
            item={it}
            start={it.progress !== null && !it.progress.watched ? it.progress.position : 0}
            autoPlay
            seek={seek}
            {...reporter}
          />
          <h1 className="text-xl font-bold">{it.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={it.channel} />
              <div className="min-w-0">
                {it.channelKey === null ? (
                  <p className="truncate font-medium">{it.channel ?? "Unknown channel"}</p>
                ) : (
                  <Link
                    to="/library/channels/$channelKey"
                    params={{ channelKey: it.channelKey }}
                    className="truncate font-medium hover:underline"
                  >
                    {it.channel}
                  </Link>
                )}
                <p className="text-xs text-muted-foreground">
                  {[
                    it.uploadDate,
                    it.duration === null ? null : formatDuration(it.duration),
                    it.profileName,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label="Watched"
                checked={it.progress?.watched ?? false}
                onCheckedChange={(watched) => {
                  setWatched(entryId, watched)
                    .then(() => client.invalidateQueries({ queryKey: itemKey(entryId) }))
                    .then(refresh)
                    .catch(fail);
                }}
              />
              Watched
            </label>
            {it.subscription === null ? null : (
              <label
                className="flex items-center gap-2 text-sm"
                title="Retention never removes this video"
              >
                <Switch
                  aria-label="Keep"
                  aria-describedby="keep-help"
                  checked={it.kept}
                  onCheckedChange={(kept) => {
                    setKept(entryId, kept)
                      .then(() => client.invalidateQueries({ queryKey: itemKey(entryId) }))
                      .catch(fail);
                  }}
                />
                Keep
                <span id="keep-help" className="sr-only">
                  Retention never removes this video
                </span>
              </label>
            )}
            <Button variant="secondary" asChild>
              <a href={`/api/library/${entryId}/file`} download>
                <Download aria-hidden /> Save
              </a>
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                confirm.ask({
                  title: `Remove "${it.title}"?`,
                  description: "It leaves your library. Others who downloaded it keep their copy.",
                  confirmLabel: "Remove",
                  destructive: true,
                  onConfirm: () => {
                    remove.mutate(entryId, {
                      onSuccess: () => {
                        void navigate({ to: "/" });
                      },
                      onError: fail,
                    });
                  },
                });
              }}
            >
              <Trash2 aria-hidden /> Remove
            </Button>
            {it.webpageUrl === null ? null : (
              <Button variant="ghost" asChild>
                <a href={it.webpageUrl} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden /> Open on the site
                </a>
              </Button>
            )}
          </div>
          {it.description === null || it.description.trim() === "" ? null : (
            <Description text={it.description} />
          )}
          <TagEditor
            tags={it.tags}
            onChange={(tags) => {
              setTags(entryId, tags)
                .then(() => client.invalidateQueries({ queryKey: itemKey(entryId) }))
                .then(refresh)
                .catch(fail);
            }}
          />
          {it.sources.length === 0 ? null : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <ListVideo className="size-4" aria-hidden /> In
              {it.sources.map((s) => (
                <Link
                  key={s.id}
                  to="/library/playlists/$sourceId"
                  params={{ sourceId: s.id }}
                  className="text-primary hover:underline"
                >
                  {s.title ?? "a playlist"}
                </Link>
              ))}
            </p>
          )}
          {confirm.dialog}
          <Chapters
            item={it}
            onSeek={(time) => {
              setSeek({ time });
            }}
          />
        </article>
        <aside aria-label="Suggestions" className="min-w-0">
          <Suggestions currentId={entryId} />
        </aside>
      </div>
    </div>
  );
}
