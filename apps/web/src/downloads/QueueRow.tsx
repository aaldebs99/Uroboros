import type { Download, DownloadProgress } from "@uroboros/contract";
import { RotateCcw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { DOWNLOAD_ERROR_TEXT } from "./errorText";
import { formatBytes, formatDuration } from "./format";

const STATE_LABEL = {
  queued: "Waiting",
  running: "Downloading",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
} as const satisfies Record<Download["state"], string>;

const PHASE_LABEL = {
  downloading: "Downloading",
  merging: "Merging",
  postprocessing: "Processing",
  storing: "Storing",
} as const satisfies Record<DownloadProgress["phase"], string>;

function Progress({ progress }: { progress: DownloadProgress }) {
  const percent = progress.percent === null ? null : Math.round(progress.percent);
  return (
    <div className="grid gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${String(percent ?? 0)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {PHASE_LABEL[progress.phase]}
        {percent === null ? "" : ` · ${String(percent)}%`}
        {progress.speed === null ? "" : ` · ${formatBytes(progress.speed)}/s`}
        {progress.eta === null ? "" : ` · ${formatDuration(progress.eta)} left`}
      </p>
    </div>
  );
}

export function QueueRow({
  download,
  progress,
  showOwner,
  onCancel,
  onRetry,
}: {
  download: Download;
  progress: DownloadProgress | null;
  showOwner: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const active = download.state === "queued" || download.state === "running";
  const live = progress ?? download.progress;
  return (
    <li className="grid gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{download.title ?? download.url}</p>
          <p className="text-xs text-muted-foreground">
            {showOwner ? `${download.owner.displayName} · ` : ""}
            {download.extractor}
          </p>
        </div>
        <Badge variant={download.state === "failed" ? "destructive" : "secondary"}>
          {STATE_LABEL[download.state]}
        </Badge>
        {active ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X aria-hidden /> Cancel
          </Button>
        ) : null}
        {download.state === "failed" || download.state === "cancelled" ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden /> Retry
          </Button>
        ) : null}
      </div>
      {download.state === "running" && live !== null ? <Progress progress={live} /> : null}
      {download.state === "failed" ? (
        <div className="grid gap-1 text-sm">
          <p className="text-destructive">{DOWNLOAD_ERROR_TEXT[download.errorKind ?? "unknown"]}</p>
          {download.stderrTail.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                {download.stderrTail.join("\n")}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
