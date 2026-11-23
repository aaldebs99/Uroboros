import type { ShareState } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { Copy, Share2 } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { stopLink, stopPeople, useMyShares, useShareAction } from "@/api/sharing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

import { expiryText } from "./expiry";
import { copyLink } from "./LinkSection";
import { ShareDialog } from "./ShareDialog";
import { SharedTabs } from "./SharedTabs";

const peopleText = (s: ShareState) =>
  s.people === null
    ? null
    : s.people.people
        .map((p) => (p.kind === "user" ? p.name : `${p.name} (${String(p.members)})`))
        .join(", ");

function ThingLink({ share }: { share: ShareState }) {
  const cls = "line-clamp-2 font-medium hover:underline";
  if (share.kind === "entry") {
    return (
      <Link to="/library/$entryId" params={{ entryId: share.id }} className={cls}>
        {share.title}
      </Link>
    );
  }
  return (
    <Link to="/library/playlists/$playlistId" params={{ playlistId: share.id }} className={cls}>
      {share.title}
    </Link>
  );
}

function ShareRow({ share }: { share: ShareState }) {
  const [changing, setChanging] = useState(false);
  const confirm = useConfirm();
  const people = useShareAction(stopPeople);
  const link = useShareAction(stopLink);
  const who = peopleText(share);
  const fail = (error: unknown) => {
    notify.error(errorText(error));
  };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-3">
      <div className="grid min-w-0 flex-1 gap-1">
        <ThingLink share={share} />
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {who === null ? null : <span>With {who}</span>}
          {share.link === null ? null : <span>Public link</span>}
          {[share.people, share.link].map((m, i) =>
            m?.expired === true ? (
              <Badge key={i} tone="warning">
                Expired
              </Badge>
            ) : m === null || m.expiresAt === null ? null : (
              <span key={i}>{expiryText(m.expiresAt, false)}</span>
            ),
          )}
        </p>
      </div>
      {share.link === null ? null : (
        <Button
          variant="ghost"
          onClick={() => {
            if (share.link !== null) copyLink(share.link.path);
          }}
        >
          <Copy aria-hidden /> Copy link
        </Button>
      )}
      <Button
        variant="secondary"
        onClick={() => {
          setChanging(true);
        }}
      >
        Change
      </Button>
      <Button
        variant="destructive"
        onClick={() => {
          confirm.ask({
            title: `Stop sharing "${share.title}"?`,
            description: "The people lose it, and the link stops working for good.",
            confirmLabel: "Stop sharing",
            destructive: true,
            onConfirm: () => {
              const t = { kind: share.kind, id: share.id };
              if (share.people !== null) people.mutate(t, { onError: fail });
              if (share.link !== null) link.mutate(t, { onError: fail });
            },
          });
        }}
      >
        Revoke
      </Button>
      {changing ? (
        <ShareDialog
          kind={share.kind}
          id={share.id}
          title={share.title}
          open
          onOpenChange={setChanging}
        />
      ) : null}
      {confirm.dialog}
    </li>
  );
}

/** Shared › By me: everything the person shares, to copy, change or revoke. */
export function SharedByMe() {
  const shares = useMyShares();
  const list = shares.data ?? [];
  return (
    <section className="grid w-full grid-cols-1 gap-6">
      <PageHeader title="Shared" />
      <SharedTabs />
      {shares.isError ? <p className="text-destructive">{errorText(shares.error)}</p> : null}
      {shares.isSuccess && list.length === 0 ? (
        <EmptyState icon={Share2} title="You share nothing yet.">
          Share a video or a playlist from its page.
        </EmptyState>
      ) : (
        <ul className="grid">
          {list.map((s) => (
            <ShareRow key={`${s.kind}:${s.id}`} share={s} />
          ))}
        </ul>
      )}
    </section>
  );
}
