import type { GroupSummary } from "@uroboros/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Users } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { useGroups } from "@/api/groups";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { GroupDialog } from "./GroupDialog";
import { SharedTabs } from "./SharedTabs";

const peopleText = (n: number) => `${String(n)} ${n === 1 ? "person" : "people"}`;

function GroupRow({ group }: { group: GroupSummary }) {
  return (
    <li className="flex items-center gap-3 rounded-[0.75rem] p-3 hover:bg-raised">
      <Avatar name={group.name} className="size-12 shrink-0 text-base" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/shared/groups/$groupId"
            params={{ groupId: group.id }}
            className="truncate text-base font-medium hover:underline focus-visible:rounded-[0.25rem] focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
          >
            {group.name}
          </Link>
          {group.role === "manager" ? <Badge>Manager</Badge> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{peopleText(group.members)}</p>
      </div>
    </li>
  );
}

/** Shared › Groups: the groups the person is in, and New group. */
export function GroupsPage() {
  const groups = useGroups();
  const [making, setMaking] = useState(false);
  const navigate = useNavigate();
  const list = groups.data ?? [];
  const newGroup = (
    <Button
      onClick={() => {
        setMaking(true);
      }}
    >
      <Plus aria-hidden /> New group
    </Button>
  );
  return (
    <section className="grid w-full grid-cols-1 gap-6">
      <PageHeader title="Shared" action={list.length > 0 ? newGroup : undefined} />
      <SharedTabs />
      {groups.isError ? <p className="text-destructive">{errorText(groups.error)}</p> : null}
      {groups.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <EmptyState icon={Users} title="No groups yet" action={newGroup}>
          Make a group to share videos and playlists with several people at once.
        </EmptyState>
      ) : (
        <ul className="grid gap-1">
          {list.map((g) => (
            <GroupRow key={g.id} group={g} />
          ))}
        </ul>
      )}
      <GroupDialog
        open={making}
        onOpenChange={setMaking}
        onSaved={(g) => {
          void navigate({ to: "/shared/groups/$groupId", params: { groupId: g.id } });
        }}
      />
    </section>
  );
}
