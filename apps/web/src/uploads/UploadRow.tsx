import type { Upload } from "@uroboros/contract";
import { RotateCcw, Upload as UploadIcon, X } from "lucide-react";
import { useId } from "react";

import { UploadBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";
import { formatBytes } from "@/downloads/format";

import type { LocalUpload } from "./UploadProvider";

function Bar({ title, sent, size }: { title: string; sent: number; size: number }) {
  const percent = size === 0 ? 100 : Math.round((sent / size) * 100);
  return (
    <div
      role="progressbar"
      aria-label={`${title} upload`}
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
  );
}

/** Picks the same file again (name and size) to send the rest of an upload a reload stopped. */
function ChooseAgain({ upload, onFile }: { upload: Upload; onFile: (file: File) => void }) {
  const inputId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">
        Choose {upload.filename} again to finish.
      </span>
      <Button variant="secondary" size="compact" asChild>
        <label htmlFor={inputId} className="cursor-pointer">
          Choose the file
        </label>
      </Button>
      <input
        id={inputId}
        type="file"
        aria-label={`Choose ${upload.filename} again`}
        className="sr-only"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked === undefined) return;
          if (picked.name !== upload.filename || picked.size !== upload.size) {
            notify.error(
              `That's not the same file: choose ${upload.filename} (${formatBytes(upload.size)}).`,
            );
            return;
          }
          onFile(picked);
        }}
      />
    </div>
  );
}

/** Try again (sending paused), Cancel (still receiving) or Dismiss (failed). */
function Actions({
  upload,
  state,
  paused,
  onCancel,
  onDismiss,
  onRetry,
}: {
  upload: Upload;
  state: Upload["state"];
  paused: boolean;
  onCancel: () => void;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      {paused ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Try ${upload.title} again`}
          onClick={onRetry}
        >
          <RotateCcw className="size-5" />
        </Button>
      ) : null}
      {state === "receiving" ? (
        <Button
          variant="ghostDestructive"
          size="icon"
          aria-label={`Cancel ${upload.title}`}
          onClick={onCancel}
        >
          <X className="size-5" />
        </Button>
      ) : null}
      {state === "failed" ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Dismiss ${upload.title}`}
          onClick={onDismiss}
        >
          <X className="size-5" />
        </Button>
      ) : null}
    </>
  );
}

/**
 * One upload on the Downloads page: Uploading with its bar while this tab sends it, Paused when
 * sending stopped (Try again, or choose the file again after a reload), Processing, or Failed.
 */
export function UploadRow({
  upload,
  local,
  onCancel,
  onDismiss,
  onResume,
  onRetry,
}: {
  upload: Upload;
  local: LocalUpload | undefined;
  onCancel: () => void;
  onDismiss: () => void;
  onResume: (file: File) => void;
  onRetry: () => void;
}) {
  const sending = local?.state === "sending";
  const state = local?.state === "processing" ? "processing" : upload.state;
  const error = local?.error ?? upload.error;
  return (
    <li className="flex gap-3 border-t border-border py-3.5 first:border-t-0 md:gap-4">
      <span className="grid aspect-video w-24 shrink-0 place-items-center rounded-[0.5rem] bg-raised md:w-30">
        <UploadIcon className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="grid min-w-0 flex-1 grid-cols-1 content-start gap-1.5">
        <p className="truncate font-medium">{upload.title}</p>
        <div className="flex items-center gap-2.5">
          <UploadBadge state={state} sending={sending} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
            {sending
              ? `${formatBytes(local.sent)} of ${formatBytes(upload.size)}`
              : `${upload.filename} · ${formatBytes(upload.size)}`}
          </span>
        </div>
        {sending ? <Bar title={upload.title} sent={local.sent} size={upload.size} /> : null}
        {state === "receiving" && local === undefined ? (
          <ChooseAgain upload={upload} onFile={onResume} />
        ) : null}
        {error === null || sending ? null : <p className="text-sm text-destructive">{error}</p>}
      </div>
      <Actions
        upload={upload}
        state={state}
        paused={local?.state === "paused"}
        onCancel={onCancel}
        onDismiss={onDismiss}
        onRetry={onRetry}
      />
    </li>
  );
}
