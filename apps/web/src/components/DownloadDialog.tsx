import { type FormatProfile, NewDownloadBody } from "@uroboros/contract";
import { LoaderCircle } from "lucide-react";
import { type SyntheticEvent, useState } from "react";

import { useProfiles } from "@/api/downloads";
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
import { useStartDownload } from "@/downloads/useStartDownload";
import { YtDlpDetails } from "@/downloads/YtDlpDetails";

/**
 * "Download a link", opened from the Add menu's Download (the top bar's pill, or the phone's "+"), or by
 * the Ctrl+K palette's "Choose a format…" with its link filled in: a form dialog that starts a
 * download in one step. A channel or playlist comes back as a preview on the Downloads page,
 * which also offers Subscribe (Subscriptions › Add subscription is `AddSubscriptionDialog`).
 */
export function DownloadDialog({
  open,
  onOpenChange,
  initialUrl = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The link to start with: the Ctrl+K palette's "Choose a format…" hands its own over. */
  initialUrl?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Download a link</DialogTitle>
        <DialogDescription className="sr-only">
          Paste a link and pick a format to start a download.
        </DialogDescription>
        <QuickDownloadForm
          initialUrl={initialUrl}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function defaultLabel(profiles: readonly FormatProfile[] | undefined): string {
  const fallback = profiles?.find((profile) => profile.isDefault);
  return fallback ? `Default (${fallback.name})` : "Default profile";
}

function QuickDownloadForm({ initialUrl, onDone }: { initialUrl: string; onDone: () => void }) {
  const profiles = useProfiles();
  const [url, setUrl] = useState(initialUrl);
  /** "" means the server's default profile. */
  const [profileId, setProfileId] = useState("");
  const download = useStartDownload(onDone);

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = NewDownloadBody.safeParse({
      url: url.trim(),
      ...(profileId === "" ? {} : { profileId }),
    });
    if (!body.success) {
      download.fail("Paste an http or https link.");
      return;
    }
    download.start(body.data);
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
        error={download.error}
        onChange={(event) => {
          setUrl(event.target.value);
          download.clear();
        }}
      />
      <YtDlpDetails lines={download.ytdlp} />
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
        <Button type="submit" disabled={download.pending}>
          {download.pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {download.pending ? "Downloading…" : "Download"}
        </Button>
      </DialogFooter>
    </form>
  );
}
