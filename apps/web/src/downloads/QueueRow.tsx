import type { Download, DownloadProgress } from "@uroboros/contract";
import { Film, RotateCcw, X } from "lucide-react";

import { DownloadBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";

import { DOWNLOAD_ERROR_TEXT } from "./errorText";
import { LoginHint } from "./LoginHint";
import { YtDlpDetails } from "./YtDlpDetails";
import { formatBytes, formatDuration } from "./format";

/** "12.4 MB/s · 38 s left", from whatever the progress knows. */
function detailOf(progress: DownloadProgress | null): string {
  if (progress === null) return "";
  return [
    progress.speed === null ? null : `${formatBytes(progress.speed)}/s`,
    progress.eta === null ? null : `${formatDuration(progress.eta)} left`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The badge, the detail and, only with a real fraction, the percentage and the glowing bar. */
function StateLine({
  download,
  progress,
  meta,
}: {
  download: Download;
  progress: DownloadProgress | null;
  meta: string;
}) {
  const running = download.state === "running" ? progress : null;
  const percent = running?.percent == null ? null : Math.round(running.percent);
  const detail = running === null ? meta : detailOf(running) || meta;
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <div className="flex items-center gap-2.5">
        <DownloadBadge state={download.state} progress={running} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {detail}
        </span>
        {percent === null ? null : (
          <span className="text-sm font-medium tabular-nums">{percent}%</span>
        )}
      </div>
      {percent === null ? null : (
        <div
          role="progressbar"
          aria-label={`${download.title ?? download.url} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-raised"
        >
          <div
            className="h-full rounded-full bg-linear-to-r from-primary-strong to-primary shadow-[0_0_0.75rem] shadow-primary/60 transition-[width]"
            style={{ width: `${String(percent)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Failure({ download }: { download: Download }) {
  return (
    <div className="grid gap-1">
      <p className="text-destructive">{DOWNLOAD_ERROR_TEXT[download.errorKind ?? "unknown"]}</p>
      <LoginHint kind={download.errorKind} />
      <YtDlpDetails lines={download.stderrTail} />
    </div>
  );
}

/** One download in the queue: a thumbnail, the title, its state line and one action. */
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
  const retryable = download.state === "failed" || download.state === "cancelled";
  const live = progress ?? download.progress;
  const title = download.title ?? download.url;
  const meta = `${showOwner ? `${download.owner.displayName} · ` : ""}${download.extractor}`;
  return (
    <li className="flex gap-3 border-t border-border py-3.5 first:border-t-0 md:gap-4">
      <span className="grid aspect-video w-24 shrink-0 place-items-center rounded-[0.5rem] bg-raised md:w-30">
        <Film className="size-5 text-muted-foreground" aria-hidden />
      </span>
      {/* grid-cols-1 (a minmax(0, 1fr) column) lets the title and state line truncate instead of
          widening the row, and with it the page, on a phone. */}
      <div className="grid min-w-0 flex-1 grid-cols-1 content-start gap-1.5">
        <p className="truncate font-medium">{title}</p>
        <StateLine download={download} progress={live} meta={meta} />
        {download.state === "failed" ? <Failure download={download} /> : null}
      </div>
      {active ? (
        <Button variant="ghostDestructive" size="icon" aria-label="Cancel" onClick={onCancel}>
          <X className="size-5" />
        </Button>
      ) : null}
      {retryable ? (
        <Button variant="ghost" size="icon" aria-label="Retry" onClick={onRetry}>
          <RotateCcw className="size-5" />
        </Button>
      ) : null}
    </li>
  );
}
