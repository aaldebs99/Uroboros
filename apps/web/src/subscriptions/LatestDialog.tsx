import { MAX_LATEST, type Subscription } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { errorText } from "@/api/client";
import { downloadLatest, subscriptionKeys } from "@/api/subscriptions";
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
import { notify } from "@/components/ui/sonner";

/**
 * "Download latest…" on a subscription: how many of its newest videos to download now (1–50),
 * whatever its filters say. A channel takes that many from each followed tab, a playlist its last
 * entries; anything the person already has, or is getting, is skipped.
 */
export function LatestButton({ sub }: { sub: Subscription }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Download aria-hidden /> Download latest…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Download the latest videos</DialogTitle>
          <DialogDescription>
            {sub.kind === "channel"
              ? "The newest of each tab you follow, whatever your filters say. Videos you already have are skipped."
              : "The playlist's last entries, whatever your filters say. Videos you already have are skipped."}
          </DialogDescription>
          {open ? (
            <LatestForm
              sub={sub}
              onDone={() => {
                setOpen(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LatestForm({ sub, onDone }: { sub: Subscription; onDone: () => void }) {
  const client = useQueryClient();
  const [count, setCount] = useState("10");
  const [busy, setBusy] = useState(false);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const n = Math.min(MAX_LATEST, Math.max(1, Math.round(Number(count)) || 1));
    setBusy(true);
    downloadLatest(sub.id, n)
      .then(async () => {
        notify.success(`Looking for the newest ${String(n)}…`, {
          detail: "They show in Downloads as they queue.",
        });
        await client.invalidateQueries({ queryKey: subscriptionKeys.all });
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
    <form className="grid gap-3.5" onSubmit={submit}>
      <Field
        label={sub.kind === "channel" ? "How many of each tab" : "How many"}
        type="number"
        min={1}
        max={MAX_LATEST}
        required
        autoFocus
        help={`Up to ${String(MAX_LATEST)}.`}
        value={count}
        onChange={(e) => {
          setCount(e.target.value);
        }}
      />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="quiet">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Download
        </Button>
      </DialogFooter>
    </form>
  );
}
