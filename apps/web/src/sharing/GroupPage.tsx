import type { GroupDetail, GroupMember } from "@uroboros/contract";
import { useNavigate } from "@tanstack/react-router";
import {
  EllipsisVertical,
  LogOut,
  Pencil,
  Shield,
  ShieldOff,
  Trash2,
  UserMinus,
} from "lucide-react";
import { useState } from "react";

import { useMe } from "@/api/auth";
import { errorText } from "@/api/client";
import {
  addMembers,
  deleteGroup,
  removeMember,
  setMemberRole,
  useGroup,
  useGroupAction,
  useGroupExit,
  useGroupShares,
} from "@/api/groups";
import { useDirectory } from "@/api/sharing";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { PageHeader } from "@/components/ui/page-header";
import { settingsColumn } from "@/components/ui/settings-column";
import { ResponsiveMenu, type MenuAction } from "@/components/ui/responsive-menu";
import { notify } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import { tileGrid } from "../library/VideoTile";
import { GroupDialog } from "./GroupDialog";
import { PeoplePicker } from "./PeoplePicker";
import { SharedTile } from "./SharedTile";

const fail = (error: unknown) => {
  notify.error(errorText(error));
};

/** The header's actions: Rename and Delete for managers, Leave for everyone. */
function GroupActions({ group, myId }: { group: GroupDetail; myId: string | undefined }) {
  const [renaming, setRenaming] = useState(false);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const toList = () => navigate({ to: "/settings/groups" });
  const remove = useGroupExit(deleteGroup, group.id, toList);
  const leave = useGroupExit(removeMember, group.id, toList);
  const busy = remove.isPending || leave.isPending;
  return (
    <div className="flex flex-wrap gap-2">
      {group.role === "manager" ? (
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setRenaming(true);
            }}
          >
            <Pencil aria-hidden /> Rename
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              confirm.ask({
                title: `Delete "${group.name}"?`,
                description: "Videos and playlists shared only with this group stop being shared.",
                confirmLabel: "Delete",
                destructive: true,
                onConfirm: () => {
                  remove.mutate(group.id, { onError: fail });
                },
              });
            }}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        </>
      ) : null}
      <Button
        variant="ghost"
        disabled={myId === undefined || busy}
        onClick={() => {
          confirm.ask({
            title: `Leave "${group.name}"?`,
            description: "Your videos shared with this group stop being shared with it.",
            confirmLabel: "Leave",
            destructive: true,
            onConfirm: () => {
              leave.mutate({ id: group.id, userId: myId ?? "" }, { onError: fail });
            },
          });
        }}
      >
        <LogOut aria-hidden /> Leave
      </Button>
      <GroupDialog open={renaming} onOpenChange={setRenaming} group={group} />
      {confirm.dialog}
    </div>
  );
}

/** A manager's menu on someone else's row. */
function memberMenu(
  m: GroupMember,
  actions: { role: (m: GroupMember) => void; remove: (m: GroupMember) => void },
): MenuAction[] {
  const roleItem: MenuAction[] =
    m.role === "manager"
      ? [
          {
            label: "Make member",
            icon: ShieldOff,
            onSelect: () => {
              actions.role(m);
            },
          },
        ]
      : m.disabled
        ? []
        : [
            {
              label: "Make manager",
              icon: Shield,
              onSelect: () => {
                actions.role(m);
              },
            },
          ];
  return [
    ...roleItem,
    {
      label: "Remove",
      icon: UserMinus,
      destructive: true,
      onSelect: () => {
        actions.remove(m);
      },
    },
  ];
}

/** Everyone in the group; a manager adds people and changes or removes the others. */
function Members({ group, myId }: { group: GroupDetail; myId: string | undefined }) {
  const manager = group.role === "manager";
  const directory = useDirectory(manager);
  const add = useGroupAction(addMembers);
  const role = useGroupAction(setMemberRole);
  const remove = useGroupAction(removeMember);
  const confirm = useConfirm();
  const inside = new Set(group.members.map((m) => `u:${m.id}`));
  const actions = {
    role: (m: GroupMember) => {
      role.mutate(
        { id: group.id, userId: m.id, role: m.role === "manager" ? "member" : "manager" },
        { onError: fail },
      );
    },
    remove: (m: GroupMember) => {
      confirm.ask({
        title: `Remove ${m.name} from "${group.name}"?`,
        description: `Their videos shared with ${group.name} stop being shared with it.`,
        confirmLabel: "Remove",
        destructive: true,
        onConfirm: () => {
          remove.mutate({ id: group.id, userId: m.id }, { onError: fail });
        },
      });
    },
  };
  return (
    <section aria-label="Members" className="grid gap-3">
      <h2 className="text-base font-bold">Members ({String(group.members.length)})</h2>
      {manager ? (
        <div className="grid gap-1">
          <PeoplePicker
            label="Add people"
            directory={directory.data}
            exclude={inside}
            groups={false}
            disabled={add.isPending}
            onPick={(p) => {
              add.mutate({ id: group.id, userIds: [p.id] }, { onError: fail });
            }}
          />
        </div>
      ) : null}
      <ul className="grid gap-0.5">
        {group.members.map((m) => (
          <li key={m.id} className="flex min-h-14 items-center gap-3 rounded-[0.75rem] px-2">
            <Avatar name={m.name} className="size-9 shrink-0 text-sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{m.name}</span>
                {m.role === "manager" ? <Badge>Manager</Badge> : null}
                {m.disabled ? (
                  <span className="text-xs text-muted-foreground">Disabled</span>
                ) : null}
              </div>
              {m.handle === null ? null : (
                <p className="truncate text-xs text-muted-foreground">{m.handle}</p>
              )}
            </div>
            {manager && m.id !== myId ? (
              <ResponsiveMenu
                title={m.name}
                actions={memberMenu(m, actions)}
                trigger={
                  <Button variant="ghost" size="icon" aria-label={`Actions for ${m.name}`}>
                    <EllipsisVertical className="size-5" aria-hidden />
                  </Button>
                }
              />
            ) : null}
          </li>
        ))}
      </ul>
      {confirm.dialog}
    </section>
  );
}

/** What the group's members share with it, the person's own included. */
function SharedWithGroup({ group }: { group: GroupDetail }) {
  const shares = useGroupShares(group.id);
  const list = shares.data ?? [];
  return (
    <section aria-label="Shared with this group" className="grid gap-3">
      <h2 className="text-base font-bold">Shared with this group</h2>
      {shares.isError ? <p className="text-destructive">{errorText(shares.error)}</p> : null}
      {shares.isPending ? null : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing shared with this group yet. Share a video or playlist and add {group.name}.
        </p>
      ) : (
        <ul className={tileGrid}>
          {list.map((s) => (
            <SharedTile key={s.shareId} share={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One group (Settings › Groups): what its members share with it, and everyone in it
 * (docs/sharing.md "Groups"), in the settings column.
 */
export function GroupPage({ groupId }: { groupId: string }) {
  const group = useGroup(groupId);
  const myId = useMe().data?.id;
  if (group.isError) {
    return (
      <section className={cn(settingsColumn, "gap-8")}>
        <BackLink to="/settings/groups" className="-mb-5">
          Groups
        </BackLink>
        <p className="text-destructive">{errorText(group.error)}</p>
      </section>
    );
  }
  const g = group.data;
  return (
    <section className={cn(settingsColumn, "gap-8")}>
      <BackLink to="/settings/groups" className="-mb-5">
        Groups
      </BackLink>
      <PageHeader
        showTitle
        title={g?.name ?? "Group"}
        description={
          g === undefined
            ? undefined
            : `Group · ${String(g.members.length)} ${g.members.length === 1 ? "person" : "people"}`
        }
        action={g === undefined ? undefined : <GroupActions group={g} myId={myId} />}
      />
      {g === undefined ? null : (
        <>
          <SharedWithGroup group={g} />
          <Members group={g} myId={myId} />
        </>
      )}
    </section>
  );
}
