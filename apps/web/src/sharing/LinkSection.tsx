import type { PublicLink, ShareKind } from "@uroboros/contract";
import { Copy } from "lucide-react";

import { errorText } from "@/api/client";
import { setLink, stopLink, useShareAction } from "@/api/sharing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";

import { ExpirySelect } from "./ExpirySelect";

/** The link's full address on this app's origin. */
export const linkUrl = (path: string) => `${window.location.origin}${path}`;

/** Copies a link and says so. */
export function copyLink(path: string): void {
  navigator.clipboard
    .writeText(linkUrl(path))
    .then(() => {
      notify.success("Link copied.");
    })
    .catch(() => {
      notify.error("Could not copy the link; select it and copy it by hand.");
    });
}

/**
 * The public link: on or off (off kills the code for good), the address with Copy, Allow
 * downloads, and an expiry.
 */
export function LinkSection({
  kind,
  id,
  link,
}: {
  kind: ShareKind;
  id: string;
  link: PublicLink | null;
}) {
  const set = useShareAction(setLink);
  const stop = useShareAction(stopLink);
  const busy = set.isPending || stop.isPending;
  const fail = (error: unknown) => {
    notify.error(`Could not change the link: ${errorText(error)}`);
  };
  const change = (allowDownload: boolean, expiresAt: string | null) => {
    set.mutate({ kind, id, body: { allowDownload, expiresAt } }, { onError: fail });
  };
  return (
    <section aria-label="Public link" className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          Public link
          {link?.expired === true ? <Badge tone="warning">Expired</Badge> : null}
        </h3>
        <Switch
          aria-label="Public link"
          checked={link !== null}
          disabled={busy}
          onCheckedChange={(on) => {
            if (on) change(false, null);
            else stop.mutate({ kind, id }, { onError: fail });
          }}
        />
      </div>
      {link === null ? null : (
        <>
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label="Link address"
              value={linkUrl(link.path)}
              className="h-10 min-w-0 flex-1 rounded-[0.5rem] border border-foreground/25 bg-transparent px-3 font-mono text-xs outline-none focus-visible:border-primary focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
              onFocus={(e) => {
                e.target.select();
              }}
            />
            <Button
              variant="secondary"
              aria-label="Copy link"
              onClick={() => {
                copyLink(link.path);
              }}
            >
              <Copy aria-hidden /> Copy
            </Button>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox
              checked={link.allowDownload}
              disabled={busy}
              onChange={(e) => {
                change(e.target.checked, link.expiresAt);
              }}
            />
            Allow downloads
          </label>
          <ExpirySelect
            label="Link expires"
            expiresAt={link.expiresAt}
            expired={link.expired}
            disabled={busy}
            onChange={(expiresAt) => {
              change(link.allowDownload, expiresAt);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Anyone with the link can watch, and save what they can play.
          </p>
        </>
      )}
    </section>
  );
}
