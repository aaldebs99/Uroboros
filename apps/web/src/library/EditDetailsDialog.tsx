import {
  EntryDetailsBody,
  UPLOAD_CREATOR_CHARS,
  UPLOAD_DESCRIPTION_CHARS,
  UPLOAD_TITLE_CHARS,
  type LibraryItem,
} from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { type SyntheticEvent, useState } from "react";

import { errorText } from "@/api/client";
import { editDetails, itemKey, replaceThumbnail } from "@/api/library";
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
import { notify } from "@/components/ui/sonner";

/**
 * "Edit details" on an uploaded video's page (its uploader only, docs/uploads.md): the title,
 * description, creator and thumbnail, changed for everyone who holds it.
 */
export function EditDetailsDialog({
  item,
  open,
  onOpenChange,
}: {
  item: LibraryItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A phone's screen is shorter than the form: the dialog scrolls inside it. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogTitle>Edit details</DialogTitle>
        <DialogDescription className="sr-only">
          Change this video&apos;s title, description, creator and thumbnail.
        </DialogDescription>
        <DetailsForm
          item={item}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function DetailsForm({ item, onDone }: { item: LibraryItem; onDone: () => void }) {
  const client = useQueryClient();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [creator, setCreator] = useState(item.channel ?? "");
  const [image, setImage] = useState<File | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [creatorError, setCreatorError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (details: EntryDetailsBody) => {
    let latest = await editDetails(item.id, details);
    if (image !== null) latest = await replaceThumbnail(item.id, image);
    client.setQueryData(itemKey(item.id), latest);
    await client.invalidateQueries({ queryKey: ["api", "library"] });
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTitleError(title.trim() === "" ? "Give it a title." : null);
    setCreatorError(creator.trim() === "" ? "Say who it is by." : null);
    const body = EntryDetailsBody.safeParse({ title, description, creator });
    if (!body.success) return;
    setBusy(true);
    save({ title: body.data.title, description: body.data.description, creator: body.data.creator })
      .then(() => {
        notify.success("Saved.");
        onDone();
      })
      .catch((err: unknown) => {
        notify.error(errorText(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form onSubmit={onSubmit} className="grid min-w-0 grid-cols-1 gap-3.5" noValidate>
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
        counter={`${String(description.length)}/${String(UPLOAD_DESCRIPTION_CHARS)}`}
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
      <ThumbnailPicker
        current={item.thumbnailUrl}
        file={image}
        onFile={setImage}
        fallback="The thumbnail it has now stays unless you pick another."
      />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="quiet">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
