import type { DownloadBatch } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { ListVideo } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { cancelBatch, downloadKeys, useBatches } from "@/api/downloads";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { notify } from "@/components/ui/sonner";

const videos = (n: number) => (n === 1 ? "1 video" : `${String(n)} videos`);

/** "Playlist · 431 waiting · 17 done · 2 failed", leaving out what is none. */
export function batchDetail(b: DownloadBatch): string {
  return [
    b.kind === "channel" ? "Channel" : "Playlist",
    `${String(b.waiting)} waiting`,
    ...(b.done > 0 ? [`${String(b.done)} done`] : []),
    ...(b.failed > 0 ? [`${String(b.failed)} failed`] : []),
  ].join(" · ");
}

/**
 * The Downloads page's queued playlists and channels with videos still waiting
 * (docs/downloads.md "Cancelling a playlist"): Cancel the rest stops all of those at once, after
 * asking; what already downloaded stays, and each cancelled video can be retried from the queue.
 */
export function BatchesSection() {
  const client = useQueryClient();
  const batches = useBatches();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const cancel = async (b: DownloadBatch) => {
    setBusy(b.id);
    try {
      const { cancelled } = await cancelBatch(b.id);
      notify.success(`Cancelled ${videos(cancelled)}.`);
      for (const queryKey of [
        downloadKeys.batches,
        downloadKeys.list(false),
        downloadKeys.active,
      ]) {
        void client.invalidateQueries({ queryKey });
      }
    } catch (err) {
      notify.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const list = batches.data ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="batches-heading" className="grid gap-1">
      <h2 id="batches-heading" className="text-base font-bold">
        Downloading from playlists
      </h2>
      <ul className="grid">
        {list.map((b) => {
          const title = b.title ?? b.url;
          return (
            <li
              key={b.id}
              className="flex items-center gap-3 border-t border-border py-3.5 first:border-t-0 md:gap-4"
            >
              <span className="grid aspect-video w-24 shrink-0 place-items-center rounded-[0.5rem] bg-raised md:w-30">
                <ListVideo className="size-5 text-muted-foreground" aria-hidden />
              </span>
              <div className="grid min-w-0 flex-1 grid-cols-1 content-start gap-1.5">
                <p className="truncate font-medium">{title}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{batchDetail(b)}</p>
              </div>
              <Button
                variant="destructive"
                size="compact"
                aria-label={`Cancel the rest of ${title}`}
                disabled={busy === b.id}
                onClick={() => {
                  confirm.ask({
                    title: `Cancel the ${videos(b.waiting)} still waiting from "${title}"?`,
                    description:
                      b.done > 0
                        ? `The ${String(b.done)} already downloaded ${b.done === 1 ? "stays" : "stay"} in your library. Each cancelled one can be retried from the queue.`
                        : "Each cancelled one can be retried from the queue.",
                    confirmLabel: `Cancel ${videos(b.waiting)}`,
                    cancelLabel: "Keep downloading",
                    destructive: true,
                    onConfirm: () => void cancel(b),
                  });
                }}
              >
                Cancel the rest
              </Button>
            </li>
          );
        })}
      </ul>
      {confirm.dialog}
    </section>
  );
}
