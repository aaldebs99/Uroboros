import type { Me } from "@uroboros/contract";
import { Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorText } from "@/api/client";
import { cancelDownload, retryDownload, useDownloadEvents, useDownloads } from "@/api/downloads";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

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
      .catch((err: unknown) => {
        notify.error(errorText(err));
      });
  };
  const cancel = act(cancelDownload);
  const retry = act(retryDownload);
  const list = downloads.data ?? [];
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-6">
      <PageHeader
        title="Downloads"
        description="Queue, progress and history."
        action={
          isAdmin ? (
            <label className="flex min-h-8 items-center gap-3">
              <Checkbox
                checked={all}
                onChange={(e) => {
                  setAll(e.target.checked);
                }}
              />
              Everyone
            </label>
          ) : undefined
        }
      />
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
      {downloads.isError ? <p className="text-destructive">{errorText(downloads.error)}</p> : null}
      {list.length === 0 && downloads.isSuccess ? (
        <EmptyState icon={Download} title="Nothing downloaded yet.">
          Paste a link above to start.
        </EmptyState>
      ) : (
        <ul className="grid">
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
