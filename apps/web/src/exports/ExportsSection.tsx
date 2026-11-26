import type { Export } from "@uroboros/contract";
import { Download, RotateCcw, Scissors, X } from "lucide-react";

import { errorText } from "@/api/client";
import { exportSaveLink, useExports, useRemoveExport, useStartExport } from "@/api/exports";
import { ExportBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { notify } from "@/components/ui/sonner";
import { formatBytes, formatDuration } from "@/downloads/format";
import { SaveButton } from "@/library/SaveButton";

/** The muted line beside the badge: what the copy is, and how far or how big. */
function detail(copy: Export): string {
  const cut = `${formatDuration(copy.cutSeconds)} cut`;
  switch (copy.state) {
    case "queued":
      return cut;
    case "running":
      return `${cut} · ${String(Math.round((copy.progress ?? 0) * 100))}%${copy.encoder === null ? "" : ` · ${copy.encoder}`}`;
    case "done":
      return copy.sizeBytes === null ? cut : `${cut} · ${formatBytes(copy.sizeBytes)}`;
    case "failed":
      return cut;
  }
}

function ExportRow({ copy }: { copy: Export }) {
  const remove = useRemoveExport();
  const again = useStartExport();
  const fail = (err: unknown) => {
    notify.error(errorText(err));
  };
  return (
    <li className="flex gap-3 border-t border-border py-3.5 first:border-t-0 md:gap-4">
      {/* Phones give the title the room instead. */}
      <span className="hidden aspect-video w-30 shrink-0 place-items-center rounded-[0.5rem] bg-raised md:grid">
        <Scissors className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="grid min-w-0 flex-1 grid-cols-1 content-start gap-1.5">
        <p className="truncate font-medium">{copy.title}</p>
        <div className="flex items-center gap-2.5">
          <ExportBadge state={copy.state} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
            {detail(copy)}
          </span>
        </div>
        {copy.state === "running" ? (
          <ProgressBar label={`${copy.title} copy`} percent={(copy.progress ?? 0) * 100} />
        ) : null}
        {copy.state === "failed" && copy.error !== null ? (
          <p className="text-sm text-destructive">{copy.error}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {copy.fileUrl === null ? null : (
          <SaveButton
            variant="secondary"
            size="compact"
            className="max-md:size-10 max-md:px-0"
            aria-label={`Save ${copy.title}`}
            href={copy.fileUrl}
            link={() => exportSaveLink(copy.id)}
          >
            <Download aria-hidden /> <span className="hidden md:inline">Save</span>
          </SaveButton>
        )}
        {copy.state === "failed" ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Try ${copy.title} again`}
            disabled={again.isPending}
            onClick={() => {
              again.mutate(copy.entryId, { onError: fail });
            }}
          >
            <RotateCcw className="size-5" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${copy.title}`}
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate(copy.id, { onError: fail });
          }}
        >
          <X className="size-5" />
        </Button>
      </div>
    </li>
  );
}

/**
 * The Downloads page's copies to save: files being re-encoded without their SponsorBlock segments,
 * and the finished ones, kept to save from here until removed (docs/transcoding.md).
 */
export function ExportsSection() {
  const list = useExports();
  const rows = list.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="exports-heading" className="grid gap-1">
      <h2 id="exports-heading" className="text-base font-bold">
        Copies to save
      </h2>
      <ul className="grid">
        {rows.map((copy) => (
          <ExportRow key={copy.id} copy={copy} />
        ))}
      </ul>
    </section>
  );
}
