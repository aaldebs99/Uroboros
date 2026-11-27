import type {
  ClipRange,
  Directory,
  PeopleShare,
  ShareKind,
  SharePersonRef,
} from "@uroboros/contract";
import { X } from "lucide-react";

import { errorText } from "@/api/client";
import { setPeople, stopPeople, useShareAction } from "@/api/sharing";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";

import { ExpirySelect } from "./ExpirySelect";
import { describe, keyOf, PeoplePicker, refOf } from "./PeoplePicker";

/**
 * Who a video, playlist or clip is shared with: add people or groups, remove them, and an expiry.
 * With `clip`, a video shared opened at it: the people it newly reaches hear of the clip. With
 * `prepare`, the thing is made first (a clip's copy; docs/sharing.md#clips), answering its id.
 */
export function PeopleSection({
  kind,
  id,
  people,
  directory,
  clip = null,
  prepare,
}: {
  kind: ShareKind;
  id: string;
  people: PeopleShare | null;
  directory: Directory | undefined;
  clip?: ClipRange | null;
  prepare?: (() => Promise<string>) | undefined;
}) {
  const set = useShareAction(setPeople);
  const stop = useShareAction(stopPeople);
  const chosen = people?.people ?? [];
  const chosenKeys = new Set(chosen.map((p) => keyOf(refOf(p))));
  const fail = (error: unknown) => {
    notify.error(`Could not change who it is shared with: ${errorText(error)}`);
  };
  const save = (refs: SharePersonRef[], expiresAt: string | null) => {
    const go = (target: string) => {
      if (refs.length === 0) {
        stop.mutate({ kind, id: target }, { onError: fail });
      } else {
        const body = { people: refs, expiresAt, ...(clip === null ? {} : { clip }) };
        set.mutate({ kind, id: target, body }, { onError: fail });
      }
    };
    if (prepare === undefined) go(id);
    else prepare().then(go, fail);
  };
  const refs = chosen.map(refOf);
  const busy = set.isPending || stop.isPending;
  return (
    <section aria-label="People" className="grid gap-3">
      <h3 className="text-sm font-bold">People</h3>
      <PeoplePicker
        label="Add people or groups"
        directory={directory}
        exclude={chosenKeys}
        groups
        disabled={busy}
        onPick={(p) => {
          save([...refs, refOf(p)], people?.expiresAt ?? null);
        }}
      />
      {chosen.length === 0 ? null : (
        <ul className="grid gap-0.5">
          {chosen.map((p) => (
            <li key={keyOf(refOf(p))} className="flex min-h-11 items-center gap-3 px-2 text-sm">
              <span className="grid min-w-0 flex-1">
                <span className="truncate">{describe(p)}</span>
                {p.kind === "group" ? (
                  <span className="text-xs text-muted-foreground">
                    Everyone in {p.name} sees this, including people added later.
                  </span>
                ) : null}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${p.name}`}
                disabled={busy}
                onClick={() => {
                  save(
                    refs.filter((r) => keyOf(r) !== keyOf(refOf(p))),
                    people?.expiresAt ?? null,
                  );
                }}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {people === null ? null : (
        <ExpirySelect
          label="Access expires"
          expiresAt={people.expiresAt}
          expired={people.expired}
          disabled={busy}
          onChange={(expiresAt) => {
            save(refs, expiresAt);
          }}
        />
      )}
    </section>
  );
}
