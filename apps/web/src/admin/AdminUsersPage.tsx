import type { AdminUser, Me } from "@uroboros/contract";
import { RefreshCw, UserPlus } from "lucide-react";
import { useState } from "react";

import { useAdminUsers, useSyncNow } from "@/api/account";
import { useAuthMethods } from "@/api/auth";
import { ApiError, errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

import { AddUserDialog } from "./AddUserForm";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { UserRow } from "./UserRow";

/** Admin › Users: everyone who can sign in, local accounts, and the Authentik sync. */
export function AdminUsersPage({ me }: { me: Me }) {
  if (me.role !== "admin") {
    return <p className="mx-auto max-w-3xl text-muted-foreground">Only admins can manage users.</p>;
  }
  return <UsersAdmin me={me} />;
}

const head = "px-2.5 py-2.5 text-xs font-medium text-muted-foreground";

function UsersTable({ me }: { me: Me }) {
  const users = useAdminUsers();
  const confirm = useConfirm();
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  if (users.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (users.isError) return <p className="text-destructive">{errorText(users.error)}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="max-md:sr-only">
          <tr>
            <th className={head}>Name</th>
            <th className={head}>Username</th>
            <th className={head}>Role</th>
            <th className={head}>Last sign-in</th>
            <th className={head}>State</th>
            <th className={head}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-md:grid">
          {users.data.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              me={me}
              onResetPassword={setResetting}
              onAskDelete={(user, remove) => {
                confirm.ask({
                  title: `Delete ${user.displayName}?`,
                  description: "This cannot be undone.",
                  confirmLabel: "Delete",
                  destructive: true,
                  onConfirm: remove,
                });
              }}
            />
          ))}
        </tbody>
      </table>
      {confirm.dialog}
      <ResetPasswordDialog
        user={resetting}
        onClose={() => {
          setResetting(null);
        }}
      />
    </div>
  );
}

function UsersAdmin({ me }: { me: Me }) {
  const methods = useAuthMethods();
  const sync = useSyncNow();
  const [adding, setAdding] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const provider = methods.data?.oidc?.displayName ?? null;
  const syncNow = () => {
    setSyncNote(null);
    sync.mutate(undefined, {
      onSuccess: () => {
        notify.success("Groups and roles refreshed.");
      },
      onError: (error) => {
        setSyncNote(
          error instanceof ApiError && error.status === 409
            ? "A sync is already running."
            : errorText(error),
        );
      },
    });
  };
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6">
      <PageHeader
        title="Users"
        description="Who can sign in, and what they can do."
        action={
          <div className="flex flex-wrap gap-2">
            {provider ? (
              <Button variant="secondary" disabled={sync.isPending} onClick={syncNow}>
                <RefreshCw className={sync.isPending ? "animate-spin" : undefined} aria-hidden />
                Sync with {provider}
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setAdding(true);
              }}
            >
              <UserPlus aria-hidden />
              Add user
            </Button>
          </div>
        }
      />
      {syncNote ? (
        <p role="status" className="text-muted-foreground">
          {syncNote}
        </p>
      ) : null}
      <AddUserDialog open={adding} onOpenChange={setAdding} />
      <UsersTable me={me} />
    </section>
  );
}
