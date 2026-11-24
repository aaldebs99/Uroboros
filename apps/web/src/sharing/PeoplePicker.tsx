import type { Directory, SharePerson, SharePersonRef } from "@uroboros/contract";
import { Users } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/ui/field";

export const refOf = (p: SharePerson): SharePersonRef =>
  p.kind === "user" ? { kind: "user", id: p.id } : { kind: "group", id: p.id };
export const keyOf = (p: SharePersonRef) => (p.kind === "user" ? `u:${p.id}` : `g:${p.id}`);
export const describe = (p: SharePerson) =>
  p.kind === "user"
    ? `${p.name}${p.handle === null ? "" : ` (${p.handle})`}`
    : `${p.name} (group, ${String(p.members)} ${p.members === 1 ? "person" : "people"})`;

/** Directory entries matching `query` that aren't excluded, at most six. */
function matches(
  directory: Directory | undefined,
  exclude: ReadonlySet<string>,
  groups: boolean,
  query: string,
) {
  const q = query.trim().toLowerCase();
  if (directory === undefined || q === "") return [];
  const people: SharePerson[] = [
    ...directory.users.map((u) => ({ kind: "user" as const, ...u })),
    ...(groups ? directory.groups.map((g) => ({ kind: "group" as const, ...g })) : []),
  ];
  return people
    .filter((p) => !exclude.has(keyOf(refOf(p))))
    .filter((p) =>
      [p.name, p.kind === "user" ? (p.handle ?? "") : ""].some((s) => s.toLowerCase().includes(q)),
    )
    .slice(0, 6);
}

/**
 * A search over the directory: people (and the caller's groups, with `groups`) matching what is
 * typed, at most six, each a button that picks it. `exclude` holds `keyOf` keys already chosen.
 */
export function PeoplePicker({
  label,
  directory,
  exclude,
  groups,
  disabled,
  onPick,
}: {
  label: string;
  directory: Directory | undefined;
  exclude: ReadonlySet<string>;
  groups: boolean;
  disabled: boolean;
  onPick: (person: SharePerson) => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <>
      <Field
        label={label}
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      <ul className="grid gap-0.5">
        {matches(directory, exclude, groups, query).map((p) => (
          <li key={keyOf(refOf(p))}>
            <button
              type="button"
              aria-label={`Add ${describe(p)}`}
              disabled={disabled}
              className="flex min-h-11 w-full items-center gap-3 rounded-[0.625rem] px-2 text-left text-sm hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none disabled:opacity-45"
              onClick={() => {
                setQuery("");
                onPick(p);
              }}
            >
              <Users className="size-4.5 text-muted-foreground" aria-hidden />
              <span>{describe(p)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
