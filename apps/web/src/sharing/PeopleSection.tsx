import type {
  Directory,
  PeopleShare,
  ShareKind,
  SharePerson,
  SharePersonRef,
} from "@uroboros/contract";
import { Users, X } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { setPeople, stopPeople, useShareAction } from "@/api/sharing";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { notify } from "@/components/ui/sonner";

import { ExpirySelect } from "./ExpirySelect";

const refOf = (p: SharePerson): SharePersonRef =>
  p.kind === "user" ? { kind: "user", id: p.id } : { kind: "group", id: p.id };
const keyOf = (p: SharePersonRef) => (p.kind === "user" ? `u:${p.id}` : `g:${p.id}`);
const describe = (p: SharePerson) =>
  p.kind === "user"
    ? `${p.name}${p.handle === null ? "" : ` (${p.handle})`}`
    : `${p.name} (group, ${String(p.members)} ${p.members === 1 ? "person" : "people"})`;

/** Directory entries matching `query` that are not chosen yet, at most six. */
function matches(directory: Directory | undefined, chosen: Set<string>, query: string) {
  const q = query.trim().toLowerCase();
  if (directory === undefined || q === "") return [];
  const people: SharePerson[] = [
    ...directory.users.map((u) => ({ kind: "user" as const, ...u })),
    ...directory.groups.map((g) => ({ kind: "group" as const, ...g })),
  ];
  return people
    .filter((p) => !chosen.has(keyOf(refOf(p))))
    .filter((p) =>
      [p.name, p.kind === "user" ? (p.handle ?? "") : ""].some((s) => s.toLowerCase().includes(q)),
    )
    .slice(0, 6);
}

/** Who a video or playlist is shared with: add people or groups, remove them, and an expiry. */
export function PeopleSection({
  kind,
  id,
  people,
  directory,
}: {
  kind: ShareKind;
  id: string;
  people: PeopleShare | null;
  directory: Directory | undefined;
}) {
  const [query, setQuery] = useState("");
  const set = useShareAction(setPeople);
  const stop = useShareAction(stopPeople);
  const chosen = people?.people ?? [];
  const chosenKeys = new Set(chosen.map((p) => keyOf(refOf(p))));
  const fail = (error: unknown) => {
    notify.error(`Could not change who it is shared with: ${errorText(error)}`);
  };
  const save = (refs: SharePersonRef[], expiresAt: string | null) => {
    if (refs.length === 0) {
      stop.mutate({ kind, id }, { onError: fail });
    } else {
      set.mutate({ kind, id, body: { people: refs, expiresAt } }, { onError: fail });
    }
  };
  const refs = chosen.map(refOf);
  const busy = set.isPending || stop.isPending;
  return (
    <section aria-label="People" className="grid gap-3">
      <h3 className="text-sm font-bold">People</h3>
      <Field
        label="Add people or groups"
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      <ul className="grid gap-0.5">
        {matches(directory, chosenKeys, query).map((p) => (
          <li key={keyOf(refOf(p))}>
            <button
              type="button"
              aria-label={`Add ${describe(p)}`}
              disabled={busy}
              className="flex min-h-11 w-full items-center gap-3 rounded-[0.625rem] px-2 text-left text-sm hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none disabled:opacity-45"
              onClick={() => {
                setQuery("");
                save([...refs, refOf(p)], people?.expiresAt ?? null);
              }}
            >
              <Users className="size-4.5 text-muted-foreground" aria-hidden />
              <span>{describe(p)}</span>
            </button>
          </li>
        ))}
      </ul>
      {chosen.length === 0 ? null : (
        <ul className="grid gap-0.5">
          {chosen.map((p) => (
            <li key={keyOf(refOf(p))} className="flex min-h-11 items-center gap-3 px-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{describe(p)}</span>
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
