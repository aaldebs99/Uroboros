import type { DownloadRequest, PreviewGroup } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Loader, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { errorText } from "@/api/client";
import { queueSelection, useRequest } from "@/api/downloads";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { DOWNLOAD_ERROR_TEXT } from "./errorText";
import { formatDuration } from "./format";

function initiallyTicked(groups: PreviewGroup[]): Set<string> {
  return new Set(groups.filter((g) => g.ticked).flatMap((g) => g.entries.map((e) => e.id)));
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
      <legend className="flex items-center gap-2 py-1 text-sm font-medium">
        <input
          type="checkbox"
          aria-label={`All ${group.name}`}
          checked={all}
          onChange={(e) => {
            toggle(ids, e.target.checked);
          }}
        />
        {group.name} <span className="text-muted-foreground">({String(ids.length)})</span>
      </legend>
      {group.truncated ? (
        <p className="text-xs text-muted-foreground">
          Only the first {String(ids.length)} are listed.
        </p>
      ) : null}
      <ul className="grid max-h-80 gap-1 overflow-y-auto">
        {group.entries.map((e) => (
          <li key={e.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={e.title ?? e.id}
              checked={ticked.has(e.id)}
              onChange={(ev) => {
                toggle([e.id], ev.target.checked);
              }}
            />
            <span className="flex-1 truncate">{e.title ?? e.id}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDuration(e.duration)}
            </span>
          </li>
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
      toast.success(
        `Queued ${String(result.queued)}${result.skipped > 0 ? `, skipped ${String(result.skipped)} you already have` : ""}.`,
      );
      await client.invalidateQueries({ queryKey: ["api", "downloads"] });
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const count = everyId.filter((id) => ticked.has(id)).length;
  return (
    <div className="grid gap-4">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTicked(new Set(everyId));
          }}
        >
          Select all
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTicked(new Set());
          }}
        >
          Select none
        </Button>
      </div>
      {req.groups.map((g) => (
        <GroupList key={g.name} group={g} ticked={ticked} toggle={toggle} />
      ))}
      <Button disabled={count === 0 || busy} onClick={() => void queue()}>
        {busy ? <Loader className="animate-spin" aria-hidden /> : null}
        Queue {String(count)} videos
      </Button>
    </div>
  );
}

/** A pasted link: probing, then the preview of a playlist or channel, or why it failed. */
export function RequestPanel({ id, onDone }: { id: string; onDone: () => void }) {
  const req = useRequest(id);
  const data = req.data;
  if (data?.state === "queued") return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="truncate">
          {data?.title ?? data?.url ?? "Looking at the link"}
        </CardTitle>
        <Button variant="ghost" size="sm" aria-label="Close" onClick={onDone}>
          <X aria-hidden />
        </Button>
      </CardHeader>
      <CardContent>
        {req.isError ? (
          <p className="text-sm text-destructive">{errorText(req.error)}</p>
        ) : data === undefined || data.state === "probing" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden /> Looking at the link…
          </p>
        ) : data.state === "failed" ? (
          <p className="text-sm text-destructive">
            {DOWNLOAD_ERROR_TEXT[data.errorKind ?? "unknown"]}
          </p>
        ) : (
          <Picker req={data} onDone={onDone} />
        )}
      </CardContent>
    </Card>
  );
}
