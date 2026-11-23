import type { Me } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { errorText } from "@/api/client";
import { cancelDownload, retryDownload, useDownloadEvents, useDownloads } from "@/api/downloads";

import { PasteForm } from "./PasteForm";
import { RequestPanel } from "./Preview";
import { QueueRow } from "./QueueRow";

/** Downloads: paste a link, finish a playlist or channel preview, and follow the live queue. */
export function DownloadsPage({ me, requestId }: { me: Me; requestId: string | null }) {
  const client = useQueryClient();
  const [active, setActive] = useState<string | null>(requestId);
  const [shown, setShown] = useState(requestId);
  if (requestId !== shown) {
    setShown(requestId);
    setActive(requestId);
  }
  const [all, setAll] = useState(false);
  const isAdmin = me.role === "admin";
  const downloads = useDownloads(all && isAdmin);
  const progress = useDownloadEvents(all && isAdmin);
  const act = (fn: (id: string) => Promise<void>) => (id: string) => {
    fn(id)
      .then(() => client.invalidateQueries({ queryKey: ["api", "downloads"] }))
      .catch((err: unknown) => toast.error(errorText(err)));
  };
  const cancel = act(cancelDownload);
  const retry = act(retryDownload);
  const list = downloads.data ?? [];
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Downloads</h1>
          <p className="mt-1 text-muted-foreground">Queue, progress and history.</p>
        </div>
        {isAdmin ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => {
                setAll(e.target.checked);
              }}
            />
            Everyone
          </label>
        ) : null}
      </div>
      <PasteForm
        onSubmitted={(req) => {
          setActive(req.id);
        }}
      />
      {active === null ? null : (
        <RequestPanel
          id={active}
          onDone={() => {
            setActive(null);
          }}
        />
      )}
      {downloads.isError ? (
        <p className="text-sm text-destructive">{errorText(downloads.error)}</p>
      ) : null}
      {list.length === 0 && downloads.isSuccess ? (
        <p className="text-sm text-muted-foreground">Nothing downloaded yet.</p>
      ) : (
        <ul className="grid gap-2">
          {list.map((d) => (
            <QueueRow
              key={d.id}
              download={d}
              progress={progress.get(d.fetchKey) ?? null}
              showOwner={all && isAdmin}
              onCancel={() => {
                cancel(d.id);
              }}
              onRetry={() => {
                retry(d.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
