import type { Upload } from "@uroboros/contract";
import { RotateCcw, Upload as UploadIcon, X } from "lucide-react";
import { useId } from "react";

import { UploadBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { notify } from "@/components/ui/sonner";
import { formatBytes } from "@/downloads/format";

import type { LocalUpload } from "./UploadProvider";

/** Picks the same file again (name and size) to send the rest of an upload a reload stopped. */
function ChooseAgain({ upload, onFile }: { upload: Upload; onFile: (file: File) => void }) {
  const inputId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">
        Choose {upload.filename} again to finish.
      </span>
      <input
        id={inputId}
        type="file"
        aria-label={`Choose ${upload.filename} again`}
        className="peer sr-only"
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
      <Button variant="secondary" size="compact" asChild>
        <label
          htmlFor={inputId}
          className="cursor-pointer peer-focus-visible:ring-[0.1875rem] peer-focus-visible:ring-ring/45"
        >
          Choose the file
        </label>
      </Button>
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
        {sending ? (
          <ProgressBar
            label={`${upload.title} upload`}
            percent={upload.size === 0 ? 100 : (local.sent / upload.size) * 100}
          />
        ) : null}
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
