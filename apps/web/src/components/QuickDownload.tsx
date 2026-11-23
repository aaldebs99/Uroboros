import { type DownloadRequest, type FormatProfile, NewDownloadBody } from "@uroboros/contract";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download, LoaderCircle, Plus } from "lucide-react";
import { type SyntheticEvent, useId, useState } from "react";
import { toast } from "sonner";

import { errorText } from "@/api/client";
import { submitDownload, useProfiles } from "@/api/downloads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** The "+" in the top bar: a paste line anchored under it that starts a download in one step. */
export function QuickDownload() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Quick download">
          <Plus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(28rem,calc(100vw-2rem))] p-3">
        <QuickDownloadForm
          onDone={() => {
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
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
  const urlId = useId();
  const profileFieldId = useId();
  const errorId = useId();
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
          toast.success(request.state === "queued" ? "Queued" : "Added, checking the link", {
            description: request.title ?? request.url,
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
    <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <Label htmlFor={urlId} className="sr-only">
        Link to download
      </Label>
      <div className="flex gap-2">
        <Input
          id={urlId}
          type="url"
          inputMode="url"
          autoFocus
          autoComplete="off"
          placeholder="Paste a link"
          value={url}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
          }}
        />
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? <LoaderCircle className="animate-spin" /> : <Download />}
          Download
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={profileFieldId} className="text-xs text-muted-foreground">
          Format
        </Label>
        <select
          id={profileFieldId}
          value={profileId}
          onChange={(event) => {
            setProfileId(event.target.value);
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">{defaultLabel(profiles.data)}</option>
          {profiles.data
            ?.filter((profile) => !profile.isDefault)
            .map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
        </select>
      </div>
      {error === null ? null : (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
