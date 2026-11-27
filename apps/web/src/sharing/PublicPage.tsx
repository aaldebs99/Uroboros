import type { ClipRange, PublicItem, PublicListItem } from "@uroboros/contract";
import { Download, Link2Off, ListVideo } from "lucide-react";
import { useState } from "react";

import { ApiError, errorText, useInfo } from "@/api/client";
import { usePublicItem, usePublicShare } from "@/api/public";
import { LinkifiedText } from "@/components/LinkifiedText";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDuration } from "@/downloads/format";
import { cn } from "@/lib/utils";

import { SaveButton } from "../library/SaveButton";
import { PlayerPlaceholder, WatchPlayer } from "../library/WatchPlayer";

const nothing = () => undefined;

function Details({ item }: { item: PublicItem }) {
  return (
    <>
      <h1 className="text-xl font-bold">{item.title}</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {[
            item.channel,
            item.uploadDate,
            item.duration === null ? null : formatDuration(item.duration),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {item.fileUrl === null ? null : (
          <SaveButton variant="secondary" href={item.fileUrl}>
            <Download aria-hidden /> Download
          </SaveButton>
        )}
      </div>
      {item.description === null || item.description.trim() === "" ? null : (
        <p className="rounded-[0.75rem] bg-raised p-3 text-sm whitespace-pre-wrap">
          <LinkifiedText text={item.description} />
        </p>
      )}
    </>
  );
}

function PlaylistList({
  title,
  items,
  currentId,
  onPick,
}: {
  title: string;
  items: PublicListItem[];
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <section aria-label="Playlist" className="grid content-start gap-2">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <ListVideo className="size-4.5" aria-hidden /> {title}
      </h2>
      <ol className="grid gap-1">
        {items.map((it, i) => (
          <li key={it.id}>
            <button
              type="button"
              aria-current={it.id === currentId ? "true" : undefined}
              onClick={() => {
                onPick(it.id);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-[0.75rem] p-1.5 text-left hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none",
                it.id === currentId && "bg-raised",
              )}
            >
              <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-[0.5rem] bg-raised">
                {it.thumbnailUrl === null ? null : (
                  <img
                    src={it.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                )}
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium">{it.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A link that answers 404 (turned off, expired, or unknown, even mid-viewing) is dead. */
function LinkFailed({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState icon={Link2Off} title="This link doesn't work any more">
        Ask whoever sent it for a new one.
      </EmptyState>
    );
  }
  return <p className="text-destructive">{errorText(error)}</p>;
}

/**
 * A public link (`/s/<code>`, docs/sharing.md): the video, or a playlist played in order, with
 * chapters, subtitles, playback sessions and the Quality menu, for anyone and without signing in. It never says
 * who shared it.
 */
/**
 * Where a video link opens: at its `?t=`, marking a clip when `&end=` comes with it and the server
 * has clips on (docs/sharing.md#clips). A playlist's link opens each video at its start.
 */
function useOpening(
  video: boolean,
  startAt: number | null | undefined,
  range: ClipRange | null | undefined,
): { start: number; range: ClipRange | null } {
  const clipsOn = useInfo().data?.clips === true;
  if (!video) return { start: 0, range: null };
  return { start: startAt ?? 0, range: clipsOn ? (range ?? null) : null };
}

export function PublicPage({
  code,
  startAt,
  range,
}: {
  code: string;
  /** A video link's `?t=`, and its `&end=` with it: the whole video opened at a clip. */
  startAt?: number | null;
  range?: ClipRange | null;
}) {
  const share = usePublicShare(code);
  const opening = useOpening(share.data?.kind === "entry", startAt, range);
  const [picked, setPicked] = useState<string | null>(null);
  const items = share.data?.items ?? [];
  const currentId = picked ?? items[0]?.id ?? null;
  const item = usePublicItem(code, currentId);
  const failed = share.isError ? share.error : item.isError ? item.error : null;
  if (failed !== null) return <LinkFailed error={failed} />;
  if (share.data === undefined) return <PlayerPlaceholder />;
  if (items.length === 0) {
    return (
      <EmptyState icon={ListVideo} title="Nothing in this playlist yet">
        Whoever shared it has not added any videos.
      </EmptyState>
    );
  }
  const at = items.findIndex((i) => i.id === currentId);
  const next = items[at + 1];
  const playlist = share.data.kind === "playlist";
  return (
    <div className="@container w-full">
      <div
        className={cn(
          "grid gap-6",
          playlist && "@6xl:grid-cols-[minmax(0,13fr)_minmax(18rem,7fr)]",
        )}
      >
        <article className="grid min-w-0 content-start gap-4">
          {item.data === undefined ? (
            <PlayerPlaceholder />
          ) : (
            <>
              <WatchPlayer
                key={item.data.id}
                item={item.data}
                start={opening.start}
                range={opening.range}
                autoPlay
                seek={null}
                onTime={nothing}
                onPause={nothing}
                onEnded={() => {
                  if (next !== undefined) setPicked(next.id);
                }}
              />
              <Details item={item.data} />
            </>
          )}
        </article>
        {playlist ? (
          <PlaylistList
            title={share.data.title}
            items={items}
            currentId={currentId}
            onPick={setPicked}
          />
        ) : null}
      </div>
    </div>
  );
}
