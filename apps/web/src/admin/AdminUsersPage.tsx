import type { Me } from "@uroboros/contract";
import { RefreshCw, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAdminUsers, useSyncNow } from "@/api/account";
import { useAuthMethods } from "@/api/auth";
import { ApiError, errorText } from "@/api/client";
import { Section } from "@/account/Section";
import { Button } from "@/components/ui/button";

import { AddUserForm } from "./AddUserForm";
import { UserRow } from "./UserRow";

/** Admin › Users: everyone who can sign in, local accounts, and the Authentik sync. */
export function AdminUsersPage({ me }: { me: Me }) {
  if (me.role !== "admin") {
    return <p className="mx-auto max-w-3xl text-muted-foreground">Only admins can manage users.</p>;
  }
  return <UsersAdmin me={me} />;
}

function UsersAdmin({ me }: { me: Me }) {
  const users = useAdminUsers();
  const methods = useAuthMethods();
  const sync = useSyncNow();
  const [adding, setAdding] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const provider = methods.data?.oidc?.displayName ?? null;
  const syncNow = () => {
    setSyncNote(null);
    sync.mutate(undefined, {
      onSuccess: () => toast.success("Groups and roles refreshed."),
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Users</h1>
          <p className="mt-1 text-muted-foreground">Who can sign in, and what they can do.</p>
        </div>
        <div className="flex gap-2">
          {provider ? (
            <Button variant="outline" disabled={sync.isPending} onClick={syncNow}>
              <RefreshCw className={sync.isPending ? "animate-spin" : undefined} aria-hidden />
              Sync with {provider}
            </Button>
          ) : null}
          <Button
            onClick={() => {
              setAdding(true);
            }}
            disabled={adding}
          >
            <UserPlus aria-hidden />
            Add user
          </Button>
        </div>
      </div>
      {syncNote ? (
        <p role="status" className="text-sm text-muted-foreground">
          {syncNote}
        </p>
      ) : null}
      {adding ? (
        <AddUserForm
          onDone={() => {
            setAdding(false);
          }}
        />
      ) : null}
      <Section icon={Users} title="Everyone">
        {users.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : users.isError ? (
          <p className="text-sm text-destructive">{errorText(users.error)}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Username</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Last sign-in</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <UserRow key={u.id} user={u} me={me} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </section>
  );
}
