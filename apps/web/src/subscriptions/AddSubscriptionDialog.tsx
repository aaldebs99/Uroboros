import { NewDownloadBody } from "@uroboros/contract";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { errorText } from "@/api/client";
import { submitDownload } from "@/api/downloads";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";

/**
 * Subscriptions › Add subscription: paste a channel or playlist link and go straight to the
 * subscription's settings (`/subscriptions/new`), which wait there while the link is looked at.
 * The request is marked `subscribe`, so a single video is refused rather than downloaded.
 */
export function AddSubscriptionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Add a subscription</DialogTitle>
        <DialogDescription>
          Paste a channel or playlist link. Next you choose how often to check it and what to
          download.
        </DialogDescription>
        {open ? (
          <SubscribeLinkForm
            onDone={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SubscribeLinkForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: submitDownload,
    onSuccess: (request) => {
      onDone();
      void navigate({ href: `/subscriptions/new?request=${encodeURIComponent(request.id)}` });
    },
    onError: (failure) => {
      setError(errorText(failure));
    },
  });
  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = NewDownloadBody.safeParse({ url: url.trim(), intent: "subscribe" });
    if (!body.success) {
      setError("Paste a web link.");
      return;
    }
    setError(null);
    submit.mutate(body.data);
  };
  return (
    <form onSubmit={onSubmit} className="grid gap-3.5" noValidate>
      <Field
        label="Channel or playlist link"
        type="url"
        inputMode="url"
        autoFocus
        autoComplete="off"
        placeholder="https://www.youtube.com/@channel"
        value={url}
        error={error}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(null);
        }}
      />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="quiet">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Continue
        </Button>
      </DialogFooter>
    </form>
  );
}
