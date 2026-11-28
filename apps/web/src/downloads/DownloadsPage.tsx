import type { Me } from "@uroboros/contract";
import { Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorText } from "@/api/client";
import {
  cancelDownload,
  confirmDownload,
  retryDownload,
  useDownloads,
  useEveryoneDownloadEvents,
} from "@/api/downloads";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

import { ExportsSection } from "@/exports/ExportsSection";
import { UploadsSection } from "@/uploads/UploadsSection";

import { useMyDownloadProgress } from "./LiveEvents";
import { PasteForm } from "./PasteForm";
import { BatchesSection } from "./BatchesSection";
import { RequestPanel } from "./Preview";
import { QueueRow } from "./QueueRow";
import { useWaitingPreviews } from "./readyPreviews";
import { ReadySection } from "./ReadySection";

/**
 * Downloads: paste a link, finish a playlist or channel preview (any still waiting for a pick are
 * listed, as in the bell), and follow the live queue.
 */
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
  const everyone = all && isAdmin;
  const downloads = useDownloads(everyone);
  // The person's own progress comes from the shell's shared stream; everyone's needs its own.
  const mine = useMyDownloadProgress();
  const theirs = useEveryoneDownloadEvents(everyone);
  const progress = everyone ? theirs : mine;
  const waiting = useWaitingPreviews();
  const act = (fn: (id: string) => Promise<void>) => (id: string) => {
    fn(id)
      .then(() => client.invalidateQueries({ queryKey: ["api", "downloads"] }))
      .catch((err: unknown) => {
        notify.error(errorText(err));
      });
  };
  const cancel = act(cancelDownload);
  const retry = act(retryDownload);
  const confirm = act((id) =>
    confirmDownload(id).then(() => {
      notify.success("Queued to download.");
    }),
  );
  const list = downloads.data ?? [];
  return (
    <section className="grid w-full grid-cols-1 gap-6">
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
      <ReadySection
        ready={waiting.ready.filter((p) => p.id !== active)}
        now={waiting.now}
        onPick={(id) => {
          setActive(id);
        }}
      />
      <BatchesSection />
      <UploadsSection />
      <ExportsSection />
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
              onConfirm={() => {
                confirm(d.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
