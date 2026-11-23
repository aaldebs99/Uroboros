import { type DownloadRequest, type FormatProfile, NewDownloadBody } from "@uroboros/contract";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { type SyntheticEvent, useState } from "react";

import { errorText } from "@/api/client";
import { submitDownload, useProfiles } from "@/api/downloads";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, SelectField } from "@/components/ui/field";
import { notify } from "@/components/ui/sonner";

/**
 * "Download a link", opened from the Create menu (the top bar's pill, or the phone's "+"): a form
 * dialog that starts a download in one step. The Subscriptions page opens it as "Add a
 * subscription" (`title`, `hint`): a channel or playlist comes back as a preview with Subscribe.
 */
export function DownloadDialog({
  open,
  onOpenChange,
  title = "Download a link",
  hint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** A visible line under the title; without it the description is for screen readers only. */
  hint?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        {hint === undefined ? (
          <DialogDescription className="sr-only">
            Paste a link and pick a format to start a download.
          </DialogDescription>
        ) : (
          <DialogDescription>{hint}</DialogDescription>
        )}
        <QuickDownloadForm
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Where a request is finished or followed: the Downloads page opens it. */
function requestHref(request: DownloadRequest): string {
  return `/downloads?request=${encodeURIComponent(request.id)}`;
}

function defaultLabel(profiles: readonly FormatProfile[] | undefined): string {
  const fallback = profiles?.find((profile) => profile.isDefault);
  return fallback ? `Default (${fallback.name})` : "Default profile";
}

function QuickDownloadForm({ onDone }: { onDone: () => void }) {
  const profiles = useProfiles();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  /** "" means the server's default profile. */
  const [profileId, setProfileId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = (request: DownloadRequest) => {
    void navigate({ href: requestHref(request) });
  };

  const submit = useMutation({
    mutationFn: submitDownload,
    onSuccess: (request) => {
      switch (request.state) {
        case "failed":
          setError(request.errorMessage ?? "That link cannot be downloaded.");
          return;
        case "choosing":
          // A playlist or channel: the person picks its entries on the Downloads page.
          onDone();
          open(request);
          return;
        case "probing":
        case "queued":
          onDone();
          notify.success(request.state === "queued" ? "Queued" : "Added, checking the link", {
            detail: request.title ?? request.url,
            action: {
              label: "View",
              onClick: () => {
                open(request);
              },
            },
          });
          return;
      }
    },
    onError: (failure) => {
      setError(errorText(failure));
    },
  });

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = NewDownloadBody.safeParse({
      url: url.trim(),
      ...(profileId === "" ? {} : { profileId }),
    });
    if (!body.success) {
      setError("Paste an http or https link.");
      return;
    }
    setError(null);
    submit.mutate(body.data);
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-3.5" noValidate>
      <Field
        label="Link"
        type="url"
        inputMode="url"
        autoFocus
        autoComplete="off"
        placeholder="https://"
        value={url}
        error={error}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(null);
        }}
      />
      <SelectField
        label="Format"
        value={profileId}
        onChange={(event) => {
          setProfileId(event.target.value);
        }}
      >
        <option value="">{defaultLabel(profiles.data)}</option>
        {profiles.data
          ?.filter((profile) => !profile.isDefault)
          .map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
      </SelectField>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="quiet">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {submit.isPending ? "Downloading…" : "Download"}
        </Button>
      </DialogFooter>
    </form>
  );
}
