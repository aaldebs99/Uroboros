import type { DownloadRequest, PreviewEntry, PreviewGroup } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Film, Loader, Rss, X } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { queueSelection, useRequest } from "@/api/downloads";
import { RequestBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { notify } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import { DOWNLOAD_ERROR_TEXT } from "./errorText";
import { formatDuration } from "./format";

function initiallyTicked(groups: PreviewGroup[]): Set<string> {
  return new Set(groups.filter((g) => g.ticked).flatMap((g) => g.entries.map((e) => e.id)));
}

/** One entry: the whole row is the checkbox's label. Unticked rows fade. */
function EntryRow({
  entry,
  on,
  toggle,
}: {
  entry: PreviewEntry;
  on: boolean;
  toggle: (on: boolean) => void;
}) {
  return (
    <li>
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-[0.625rem] px-2 py-2 hover:bg-raised",
          !on && "opacity-55",
        )}
      >
        <Checkbox
          aria-label={entry.title ?? entry.id}
          checked={on}
          onChange={(ev) => {
            toggle(ev.target.checked);
          }}
        />
        <span className="relative grid aspect-video w-30 shrink-0 place-items-center overflow-hidden rounded-[0.5rem] bg-raised">
          {entry.thumbnailUrl === null ? (
            <Film className="size-5 text-muted-foreground" aria-hidden />
          ) : (
            <img
              src={entry.thumbnailUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          )}
        </span>
        <span className="grid min-w-0 flex-1">
          <span className="line-clamp-2 font-medium">{entry.title ?? entry.id}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {[entry.uploader, formatDuration(entry.duration)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </label>
    </li>
  );
}

function GroupList({
  group,
  ticked,
  toggle,
}: {
  group: PreviewGroup;
  ticked: Set<string>;
  toggle: (ids: string[], on: boolean) => void;
}) {
  const ids = group.entries.map((e) => e.id);
  const all = ids.length > 0 && ids.every((id) => ticked.has(id));
  return (
    <fieldset className="grid gap-1">
      <legend className="flex items-center gap-3 px-2 py-1.5 font-medium">
        <Checkbox
          aria-label={`All ${group.name}`}
          checked={all}
          onChange={(e) => {
            toggle(ids, e.target.checked);
          }}
        />
        {group.name} <span className="text-muted-foreground">({String(ids.length)})</span>
      </legend>
      {group.truncated ? (
        <p className="px-2 text-xs text-muted-foreground">
          Only the first {String(ids.length)} are listed.
        </p>
      ) : null}
      <ul className="grid max-h-96 overflow-y-auto">
        {group.entries.map((e) => (
          <EntryRow
            key={e.id}
            entry={e}
            on={ticked.has(e.id)}
            toggle={(on) => {
              toggle([e.id], on);
            }}
          />
        ))}
      </ul>
    </fieldset>
  );
}

function Picker({ req, onDone }: { req: DownloadRequest; onDone: () => void }) {
  const client = useQueryClient();
  const [ticked, setTicked] = useState(() => initiallyTicked(req.groups));
  const [busy, setBusy] = useState(false);
  const everyId = req.groups.flatMap((g) => g.entries.map((e) => e.id));
  const toggle = (ids: string[], on: boolean) => {
    setTicked((old) => {
      const next = new Set(old);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  const queue = async () => {
    setBusy(true);
    try {
      const chosen = everyId.filter((id) => ticked.has(id));
      const result = await queueSelection(req.id, chosen);
      notify.success(
        `Queued ${String(result.queued)}${result.skipped > 0 ? `, skipped ${String(result.skipped)} you already have` : ""}.`,
      );
      await client.invalidateQueries({ queryKey: ["api", "downloads"] });
      onDone();
    } catch (err) {
      notify.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const count = everyId.filter((id) => ticked.has(id)).length;
  const allOn = count === everyId.length;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-muted-foreground">
          {String(count)} of {String(everyId.length)} selected
        </p>
        <Button
          variant="quiet"
          size="compact"
          onClick={() => {
            setTicked(allOn ? new Set() : new Set(everyId));
          }}
        >
          {allOn ? "Select none" : "Select all"}
        </Button>
        {allOn ? null : (
          <Button
            variant="quiet"
            size="compact"
            onClick={() => {
              setTicked(new Set());
            }}
          >
            Select none
          </Button>
        )}
        <SubscribeLink requestId={req.id} />
        <Button size="compact" disabled={count === 0 || busy} onClick={() => void queue()}>
          {busy ? <Loader className="animate-spin" aria-hidden /> : null}
          Queue {String(count)} videos
        </Button>
      </div>
      {req.groups.map((g) => (
        <GroupList key={g.name} group={g} ticked={ticked} toggle={toggle} />
      ))}
    </div>
  );
}

/** Subscribe to the previewed channel or playlist instead of (or as well as) queueing entries. */
function SubscribeLink({ requestId }: { requestId: string }) {
  const navigate = useNavigate();
  const href = `/subscriptions/new?request=${encodeURIComponent(requestId)}`;
  return (
    <Button variant="secondary" size="compact" asChild>
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          void navigate({ href });
        }}
      >
        <Rss aria-hidden /> Subscribe
      </a>
    </Button>
  );
}

function PanelBody({
  req,
  data,
}: {
  req: ReturnType<typeof useRequest>;
  data: DownloadRequest | undefined;
}) {
  if (req.isError) return <p className="text-destructive">{errorText(req.error)}</p>;
  if (data === undefined || data.state === "probing") {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader className="size-4 animate-spin" aria-hidden /> Looking at the link…
      </p>
    );
  }
  if (data.state === "failed") {
    return <p className="text-destructive">{DOWNLOAD_ERROR_TEXT[data.errorKind ?? "unknown"]}</p>;
  }
  return null;
}

/** A pasted link: probing, then the preview of a playlist or channel, or why it failed. */
export function RequestPanel({ id, onDone }: { id: string; onDone: () => void }) {
  const req = useRequest(id);
  const data = req.data;
  if (data?.state === "queued") return null;
  return (
    <div className="grid gap-3 rounded-2xl bg-card p-4 shadow-card">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-base font-bold">
          {data?.title ?? data?.url ?? "Looking at the link"}
        </p>
        {data === undefined ? null : <RequestBadge state={data.state} />}
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onDone}>
          <X className="size-5" aria-hidden />
        </Button>
      </div>
      {data?.state === "choosing" ? (
        <Picker req={data} onDone={onDone} />
      ) : (
        <PanelBody req={req} data={data} />
      )}
    </div>
  );
}
