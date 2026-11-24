import {
  MAX_TAGS,
  NewUploadBody,
  UPLOAD_CREATOR_CHARS,
  UPLOAD_DESCRIPTION_CHARS,
  UPLOAD_EXTENSIONS,
  UPLOAD_TITLE_CHARS,
} from "@uroboros/contract";
import { Film, LoaderCircle, Upload } from "lucide-react";
import { type DragEvent, type SyntheticEvent, useEffect, useId, useState } from "react";

import { ApiError, errorText } from "@/api/client";
import { ThumbnailPicker } from "@/components/ThumbnailPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, TextareaField } from "@/components/ui/field";
import { formatBytes } from "@/downloads/format";

import { useUploads } from "./UploadProvider";

const WRONG_TYPE = "Uploads must be MP4, M4V, MOV, WebM, MKV or AVI files.";
const ACCEPT = ["video/*", ...UPLOAD_EXTENSIONS.map((e) => `.${e}`)].join(",");

/** The file's extension when uploads take it. */
const takes = (name: string) =>
  (UPLOAD_EXTENSIONS as readonly string[]).includes(name.split(".").pop()?.toLowerCase() ?? "");

/** "Holiday trip.mp4" → "Holiday trip". */
const titleOf = (name: string) =>
  (name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name).trim().slice(0, 200);

/** "Beach, sea, beach" → ["beach", "sea"]: trimmed, lower-cased, each once, 20 at most. */
export function parseTags(text: string): string[] {
  const tags = text
    .split(",")
    .map((t) => t.trim().toLowerCase().slice(0, 32))
    .filter((t) => t !== "");
  return [...new Set(tags)].slice(0, MAX_TAGS);
}

/** A server refusal in words: its own message for a file over the size it takes. */
function refusal(err: unknown): string {
  if (err instanceof ApiError && err.body?.code === "payload_too_large") {
    const m = err.body.message;
    return `${m.charAt(0).toUpperCase()}${m.slice(1)}.`;
  }
  return errorText(err);
}

/**
 * "Upload a video", from the Add menu (docs/uploads.md): a file, its title (the file's name to
 * start with), description, creator (the person, unless they name someone), tags and a thumbnail.
 * Once sent it shows the upload's progress; Hide keeps it going (the Downloads page lists it).
 */
export function UploadDialog({
  open,
  onOpenChange,
  creator,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Who the video is by unless the person names someone: their display name. */
  creator: string;
}) {
  const [uploadId, setUploadId] = useState<string | null>(null);
  const close = () => {
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A phone's screen is shorter than the form: the dialog scrolls inside it. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogTitle>Upload a video</DialogTitle>
        <DialogDescription className="sr-only">
          Pick a video, give it a title and the rest, and upload it to your library.
        </DialogDescription>
        {uploadId === null ? (
          <UploadForm creator={creator} onStarted={setUploadId} />
        ) : (
          <UploadProgress id={uploadId} onClose={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileChooser({
  file,
  error,
  onPick,
}: {
  file: File | null;
  error: string | null;
  onPick: (file: File) => void;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped !== undefined) onPick(dropped);
  };
  return (
    <div className="grid gap-1">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={onDrop}
        className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-raised p-4 ${over ? "ring-[0.1875rem] ring-ring/45" : ""}`}
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-background">
          {file === null ? (
            <Upload className="size-5 text-muted-foreground" aria-hidden />
          ) : (
            <Film className="size-5 text-muted-foreground" aria-hidden />
          )}
        </span>
        <div className="grid min-w-0 flex-1 basis-32 grid-cols-1">
          {file === null ? (
            <p className="text-sm text-muted-foreground">
              <span className="hidden md:inline">Drop a video here, or choose one.</span>
              <span className="md:hidden">Choose a video from this device.</span>
            </p>
          ) : (
            <>
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </>
          )}
        </div>
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          aria-label="Choose a video"
          className="peer sr-only"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            if (picked !== undefined) onPick(picked);
          }}
        />
        <Button variant="secondary" asChild>
          <label
            htmlFor={inputId}
            className="cursor-pointer peer-focus-visible:ring-[0.1875rem] peer-focus-visible:ring-ring/45"
          >
            {file === null ? "Choose a video" : "Change"}
          </label>
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="px-0.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function UploadForm({
  creator: initialCreator,
  onStarted,
}: {
  creator: string;
  onStarted: (id: string) => void;
}) {
  const uploads = useUploads();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [creator, setCreator] = useState(initialCreator.slice(0, UPLOAD_CREATOR_CHARS));
  const [creatorError, setCreatorError] = useState<string | null>(null);
  const [tags, setTags] = useState("");
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (picked: File) => {
    if (!takes(picked.name)) {
      setFileError(WRONG_TYPE);
      return;
    }
    setFileError(null);
    // The file's name is the title until the person writes their own.
    if (file === null ? title.trim() === "" : title === titleOf(file.name)) {
      setTitle(titleOf(picked.name));
      setTitleError(null);
    }
    setFile(picked);
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFileError(file === null ? "Choose a video." : null);
    setTitleError(title.trim() === "" ? "Give it a title." : null);
    setCreatorError(creator.trim() === "" ? "Say who it is by." : null);
    if (file === null) return;
    const body = NewUploadBody.safeParse({
      filename: file.name,
      size: file.size,
      title,
      description,
      creator,
      tags: parseTags(tags),
    });
    if (!body.success) return;
    const { filename: _name, size: _size, ...details } = body.data;
    setBusy(true);
    setFailure(null);
    uploads
      .start(file, details, thumbnail)
      .then(onStarted)
      .catch((err: unknown) => {
        setFailure(refusal(err));
        setBusy(false);
      });
  };

  return (
    <form onSubmit={onSubmit} className="grid min-w-0 grid-cols-1 gap-3.5" noValidate>
      <FileChooser file={file} error={fileError} onPick={pick} />
      <Field
        label="Title"
        value={title}
        maxLength={UPLOAD_TITLE_CHARS}
        counter={`${String(title.length)}/${String(UPLOAD_TITLE_CHARS)}`}
        error={titleError}
        onChange={(event) => {
          setTitle(event.target.value);
          setTitleError(null);
        }}
      />
      <TextareaField
        label="Description"
        value={description}
        maxLength={UPLOAD_DESCRIPTION_CHARS}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
      />
      <Field
        label="Creator"
        value={creator}
        maxLength={UPLOAD_CREATOR_CHARS}
        help="Who the video is by; your uploads are grouped under it."
        error={creatorError}
        onChange={(event) => {
          setCreator(event.target.value);
          setCreatorError(null);
        }}
      />
      <Field
        label="Tags"
        value={tags}
        help="Separate them with commas."
        onChange={(event) => {
          setTags(event.target.value);
        }}
      />
      <ThumbnailPicker
        current={null}
        file={thumbnail}
        onFile={setThumbnail}
        fallback="Without one, a frame from the video is used."
      />
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="quiet">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {busy ? "Starting…" : "Upload"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** An upload's progress in the dialog; it closes once the video is in the library. */
function UploadProgress({ id, onClose }: { id: string; onClose: () => void }) {
  const uploads = useUploads();
  const upload = uploads.local.get(id);
  const state = upload?.state ?? "sending";
  useEffect(() => {
    if (state === "done") onClose();
  }, [state, onClose]);
  if (upload === undefined) return null;
  const percent = upload.size === 0 ? 100 : Math.round((upload.sent / upload.size) * 100);
  const unfinished = state === "sending" || state === "paused";
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-1.5">
        <p className="truncate font-medium">{upload.title}</p>
        {state === "sending" || state === "paused" ? (
          <>
            <div
              role="progressbar"
              aria-label={`${upload.title} upload`}
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
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatBytes(upload.sent)} of {formatBytes(upload.size)}
            </p>
          </>
        ) : null}
        {state === "processing" ? (
          <p className="text-sm text-muted-foreground">
            Uploaded. Checking the video; it shows in your library in a moment.
          </p>
        ) : null}
        {upload.error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {upload.error}
          </p>
        )}
      </div>
      <DialogFooter>
        {unfinished ? (
          <Button
            variant="quiet"
            className="text-destructive"
            onClick={() => {
              void uploads.cancel(id).finally(onClose);
            }}
          >
            Cancel upload
          </Button>
        ) : null}
        {state === "paused" ? (
          <Button
            variant="quiet"
            onClick={() => {
              uploads.retry(id);
            }}
          >
            Try again
          </Button>
        ) : null}
        <Button variant="quiet" onClick={onClose}>
          {state === "failed" ? "Close" : "Hide"}
        </Button>
      </DialogFooter>
    </div>
  );
}
