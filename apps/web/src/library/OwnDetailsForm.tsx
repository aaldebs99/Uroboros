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
import { editDetails, itemKey, resetDetails, useChannels } from "@/api/library";
import { Button } from "@/components/ui/button";
import { ComboboxField } from "@/components/ui/combobox-field";
import { useConfirm } from "@/components/ui/confirm";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Field, TextareaField } from "@/components/ui/field";
import { notify } from "@/components/ui/sonner";

/** What the form holds. */
interface Fields {
  title: string;
  description: string;
  channel: string;
}

/**
 * The details to send: only those changed from what the item shows (a site's title may be longer
 * than the limit, and is fine left as it is); a description cleared is none.
 */
export function changedDetails(
  item: Pick<LibraryItem, "title" | "description" | "channel">,
  f: Fields,
): EntryDetailsBody {
  const title = f.title.trim();
  const description = f.description.trim();
  const channel = f.channel.trim();
  return {
    ...(title === item.title.trim() ? {} : { title }),
    ...(description === (item.description ?? "").trim()
      ? {}
      : { description: description === "" ? null : description }),
    ...(channel === (item.channel ?? "").trim() ? {} : { creator: channel }),
  };
}

/** Each refused field's message, or none; a site's long title is fine left as it is. */
function problems(item: LibraryItem, f: Fields): { title: string | null; channel: string | null } {
  const title = f.title.trim();
  const tooLong = title.length > UPLOAD_TITLE_CHARS && title !== item.title.trim();
  return {
    title:
      title === ""
        ? "Give it a title."
        : tooLong
          ? `Up to ${String(UPLOAD_TITLE_CHARS)} characters.`
          : null,
    channel: f.channel.trim() === "" ? "Name its channel." : null,
  };
}

/** Its site's (or uploader's) value as help under a field, while the person's own differs. */
function beside(item: LibraryItem, mine: string | null, theirs: string | null | undefined) {
  if (!item.edited || theirs == null || mine === theirs) return undefined;
  return `${item.origin === "upload" ? "From the uploader" : "On the site"}: ${theirs}`;
}

/** The person's channel names, once each, to suggest. */
function useChannelNames(): string[] {
  const channels = useChannels();
  return [...new Set((channels.data ?? []).map((c) => c.name))];
}

/**
 * A title, description and channel of the person's own for a video they hold and didn't upload
 * (docs/library.md#your-own-details): only what they change is sent; naming a channel moves the
 * video to theirs of that name, or a new one; Reset, once confirmed, goes back to the site's (or
 * uploader's).
 */
export function OwnDetailsForm({ item, onDone }: { item: LibraryItem; onDone: () => void }) {
  const client = useQueryClient();
  const names = useChannelNames();
  const [fields, setFields] = useState<Fields>({
    title: item.title,
    description: item.description ?? "",
    channel: item.channel ?? "",
  });
  const [errors, setErrors] = useState<ReturnType<typeof problems>>({
    title: null,
    channel: null,
  });
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const from = item.origin === "upload" ? "the uploader's" : "the site's";

  const set = (key: keyof Fields) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    if (key !== "description") setErrors((e) => ({ ...e, [key]: null }));
  };

  // A video's details show on its pages, in lists, shares and copies.
  const refresh = async (latest: LibraryItem | null) => {
    if (latest !== null) client.setQueryData(itemKey(item.id), latest);
    await Promise.all(
      ["library", "shares", "shared", "exports", "groups"].map((k) =>
        client.invalidateQueries({ queryKey: ["api", k] }),
      ),
    );
  };

  const run = (work: () => Promise<void>, done: string) => {
    setBusy(true);
    work()
      .then(() => {
        notify.success(done);
        onDone();
      })
      .catch((err: unknown) => {
        notify.error(errorText(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = problems(item, fields);
    setErrors(found);
    const body = EntryDetailsBody.safeParse(changedDetails(item, fields));
    if (found.title !== null || found.channel !== null || !body.success) return;
    if (Object.keys(body.data).length === 0) {
      onDone();
      return;
    }
    run(async () => {
      await refresh(await editDetails(item.id, body.data));
    }, "Saved.");
  };

  // Asked first: the person's own details go, for them and whoever they shared the video with.
  const onReset = () => {
    confirm.ask({
      title: `Reset to ${from} details?`,
      description:
        "Your own title, description and channel for this video go, for you and whoever you shared it with.",
      confirmLabel: "Reset",
      destructive: true,
      onConfirm: () => {
        run(async () => {
          await resetDetails(item.id);
          await refresh(null);
        }, `Back to ${from} details.`);
      },
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid min-w-0 grid-cols-1 gap-3.5" noValidate>
      <Field
        label="Title"
        value={fields.title}
        maxLength={Math.max(UPLOAD_TITLE_CHARS, item.title.length)}
        counter={`${String(fields.title.length)}/${String(UPLOAD_TITLE_CHARS)}`}
        help={beside(item, item.title, item.original?.title)}
        error={errors.title}
        onChange={(event) => {
          set("title")(event.target.value);
        }}
      />
      <TextareaField
        label="Description"
        value={fields.description}
        maxLength={Math.max(UPLOAD_DESCRIPTION_CHARS, (item.description ?? "").length)}
        counter={`${String(fields.description.length)}/${String(UPLOAD_DESCRIPTION_CHARS)}`}
        onChange={(event) => {
          set("description")(event.target.value);
        }}
      />
      <ComboboxField
        label="Channel"
        free
        options={names}
        value={fields.channel}
        maxLength={UPLOAD_CREATOR_CHARS}
        help={
          beside(item, item.channel, item.original?.channel) ??
          "Moves it to your channel of that name, or a new one."
        }
        error={errors.channel}
        onChange={set("channel")}
      />
      <DialogFooter className="flex-wrap">
        {item.edited ? (
          <Button
            type="button"
            variant="quiet"
            className="mr-auto"
            disabled={busy}
            onClick={onReset}
          >
            Reset to {from} details
          </Button>
        ) : null}
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
      {confirm.dialog}
    </form>
  );
}
