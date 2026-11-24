import { THUMBNAIL_MAX_BYTES, THUMBNAIL_TYPES } from "@uroboros/contract";
import { Film, ImagePlus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";

/** What a picked image may be: the server checks its bytes too (docs/uploads.md). */
export function thumbnailProblem(file: File): string | null {
  if (!(THUMBNAIL_TYPES as readonly string[]).includes(file.type)) {
    return "Pick a JPEG, PNG or WebP image.";
  }
  if (file.size > THUMBNAIL_MAX_BYTES) return "Pick an image of up to 5 MiB.";
  return null;
}

/** A picked file as a data: URL, which the page's image policy allows (blob: it does not). */
function usePreview(file: File | null): string | null {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (file === null) return;
    let live = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (live && typeof reader.result === "string") setPreview({ file, url: reader.result });
    };
    reader.readAsDataURL(file);
    return () => {
      live = false;
    };
  }, [file]);
  return preview !== null && preview.file === file ? preview.url : null;
}

/**
 * A video's thumbnail and a button to pick another: the picked image previews at once. `current`
 * is the thumbnail it has now (null: none yet, `fallback` says what stands in).
 */
export function ThumbnailPicker({
  current,
  file,
  onFile,
  fallback,
}: {
  current: string | null;
  file: File | null;
  onFile: (file: File | null) => void;
  /** Said under the box when no image is picked. */
  fallback: string;
}) {
  const inputId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const preview = usePreview(file);
  const shown = preview ?? current;
  return (
    <div className="grid gap-2">
      <span className="text-xs text-muted-foreground">Thumbnail</span>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex aspect-video w-36 shrink-0 items-center justify-center overflow-hidden rounded-[0.75rem] bg-raised">
          {shown === null ? (
            <Film className="size-6 text-muted-foreground" aria-hidden />
          ) : (
            <img
              src={shown}
              alt={preview === null ? "The current thumbnail" : "The new thumbnail"}
              className="size-full object-cover"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <label htmlFor={inputId} className="cursor-pointer">
              <ImagePlus aria-hidden /> Choose an image
            </label>
          </Button>
          {file === null ? null : (
            <Button
              variant="quiet"
              onClick={() => {
                onFile(null);
              }}
            >
              <X aria-hidden /> Keep the old one
            </Button>
          )}
        </div>
        <input
          id={inputId}
          type="file"
          accept={THUMBNAIL_TYPES.join(",")}
          aria-label="Choose a thumbnail"
          className="sr-only"
          onChange={(event) => {
            const picked = event.target.files?.[0] ?? null;
            event.target.value = "";
            if (picked === null) return;
            const why = thumbnailProblem(picked);
            setProblem(why);
            if (why === null) onFile(picked);
          }}
        />
      </div>
      {problem === null ? (
        file === null ? (
          <p className="px-0.5 text-xs text-muted-foreground">{fallback}</p>
        ) : null
      ) : (
        <p role="alert" className="px-0.5 text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
