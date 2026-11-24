import type { AdminGroup, Me } from "@uroboros/contract";

import { errorText } from "@/api/client";
import { adminDeleteGroup, useAllGroups, useGroupAction } from "@/api/groups";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

const head = "px-2.5 py-2.5 text-xs font-medium text-muted-foreground";
const cell = "px-2.5 py-2 max-md:px-0 max-md:py-0.5";
const created = (iso: string) => new Date(iso).toLocaleDateString();

function GroupRow({ group, onDelete }: { group: AdminGroup; onDelete: (g: AdminGroup) => void }) {
  return (
    <tr className="border-t border-border max-md:grid max-md:gap-1 max-md:py-3">
      <td className={`${cell} font-medium`}>{group.name}</td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">People: </span>
        {String(group.members)}
      </td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">Managers: </span>
        {group.managers.length === 0 ? "none" : group.managers.join(", ")}
      </td>
      <td className={`${cell} text-muted-foreground`}>{created(group.createdAt)}</td>
      <td className={`${cell} md:text-right`}>
        <Button
          variant="destructive"
          size="compact"
          aria-label={`Delete ${group.name}`}
          onClick={() => {
            onDelete(group);
          }}
        >
          Delete
        </Button>
      </td>
    </tr>
  );
}

function GroupsTable() {
  const groups = useAllGroups();
  const remove = useGroupAction(adminDeleteGroup);
  const confirm = useConfirm();
  if (groups.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (groups.isError) return <p className="text-destructive">{errorText(groups.error)}</p>;
  if (groups.data.length === 0) return <p className="text-muted-foreground">No groups yet.</p>;
  const ask = (g: AdminGroup) => {
    confirm.ask({
      title: `Delete "${g.name}"?`,
      description: "Videos and playlists shared only with this group stop being shared.",
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => {
        remove.mutate(g.id, {
          onError: (error) => {
            notify.error(`Could not delete the group: ${errorText(error)}`);
          },
        });
      },
    });
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="max-md:sr-only">
          <tr>
            <th className={head}>Name</th>
            <th className={head}>People</th>
            <th className={head}>Managers</th>
            <th className={head}>Created</th>
            <th className={head}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-md:grid">
          {groups.data.map((g) => (
            <GroupRow key={g.id} group={g} onDelete={ask} />
          ))}
        </tbody>
      </table>
      {confirm.dialog}
    </div>
  );
}

/** Admin › Groups: every group people made, and Delete (never what is shared with them). */
export function AdminGroupsPage({ me }: { me: Me }) {
  if (me.role !== "admin") {
    return (
      <p className="mx-auto max-w-3xl text-muted-foreground">Only admins can manage groups.</p>
    );
  }
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6">
      <PageHeader title="Groups" description="Every group people made, and who runs it." />
      <GroupsTable />
    </section>
  );
}
