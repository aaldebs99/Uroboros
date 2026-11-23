import type { AdminUser, Me } from "@uroboros/contract";

import { useDeleteUser, usePatchUser } from "@/api/account";
import { errorText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";

const when = (iso: string | null) => (iso === null ? "never" : new Date(iso).toLocaleString());
const fail = (what: string) => (error: unknown) => {
  notify.error(`Could not ${what}: ${errorText(error)}`);
};
const roleName = (user: AdminUser) => (user.role === "admin" ? "Admin" : "Member");

function RoleCell({ user }: { user: AdminUser }) {
  if (user.method === "local") return <span>{roleName(user)}</span>;
  return (
    <span className="flex flex-col">
      <span>{roleName(user)}</span>
      <span className="text-xs text-muted-foreground">Set by Authentik groups</span>
    </span>
  );
}

function StateCell({ user }: { user: AdminUser }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {user.disabled ? <Badge tone="destructive">Disabled</Badge> : null}
      {user.revoked ? <Badge tone="warning">Revoked by Authentik</Badge> : null}
      {user.isBootstrap ? <Badge tone="muted">Bootstrap</Badge> : null}
    </span>
  );
}

/** What an admin may do to `user`; mirrors the server's 409 rules. */
function allowed(user: AdminUser, me: Me) {
  const self = user.id === me.id;
  const local = user.method === "local";
  return {
    changeRole: local && !self,
    resetPassword: local && !self,
    disable: !self && !user.isBootstrap,
    remove: local && !self && !user.isBootstrap,
  };
}

type RowHandlers = {
  /** Opens the reset-password dialog for this user. */
  onResetPassword: (user: AdminUser) => void;
  /** Asks before deleting; calls `remove` once confirmed. */
  onAskDelete: (user: AdminUser, remove: () => void) => void;
};

function Actions({
  user,
  me,
  onResetPassword,
  onAskDelete,
}: { user: AdminUser; me: Me } & RowHandlers) {
  const patch = usePatchUser();
  const remove = useDeleteUser();
  const may = allowed(user, me);
  const name = user.displayName;
  const toAdmin = user.role !== "admin";
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {may.changeRole ? (
        <Button
          variant="quiet"
          size="compact"
          aria-label={toAdmin ? `Make ${name} an admin` : `Make ${name} a member`}
          onClick={() => {
            patch.mutate(
              { id: user.id, patch: { role: toAdmin ? "admin" : "member" } },
              { onError: fail("change the role") },
            );
          }}
        >
          {toAdmin ? "Make admin" : "Make member"}
        </Button>
      ) : null}
      {may.resetPassword ? (
        <Button
          variant="quiet"
          size="compact"
          aria-label={`Reset password for ${name}`}
          onClick={() => {
            onResetPassword(user);
          }}
        >
          Reset password
        </Button>
      ) : null}
      {may.disable ? (
        <Button
          variant="quiet"
          size="compact"
          aria-label={`${user.disabled ? "Enable" : "Disable"} ${name}`}
          onClick={() => {
            patch.mutate(
              { id: user.id, patch: { disabled: !user.disabled } },
              { onError: fail("change the account") },
            );
          }}
        >
          {user.disabled ? "Enable" : "Disable"}
        </Button>
      ) : null}
      {may.remove ? (
        <Button
          variant="destructive"
          size="compact"
          aria-label={`Delete ${name}`}
          onClick={() => {
            onAskDelete(user, () => {
              remove.mutate(user.id, { onError: fail("delete the user") });
            });
          }}
        >
          Delete
        </Button>
      ) : null}
    </span>
  );
}

const cell = "px-2.5 py-3.5 max-md:p-0";

/** One user in Admin › Users: a table row from `md` up, a stacked block below. */
export function UserRow({ user, me, ...handlers }: { user: AdminUser; me: Me } & RowHandlers) {
  return (
    <tr className="border-t border-border align-middle hover:bg-raised max-md:grid max-md:gap-1.5 max-md:py-3.5">
      <td className={`${cell} font-medium`}>{user.displayName}</td>
      <td className={`${cell} text-muted-foreground`}>{user.username ?? "SSO"}</td>
      <td className={cell}>
        <RoleCell user={user} />
      </td>
      <td className={`${cell} text-xs text-muted-foreground`}>
        <span className="md:hidden">Last sign-in: </span>
        {when(user.lastLoginAt)}
      </td>
      <td className={cell}>
        <StateCell user={user} />
      </td>
      <td className={`${cell} text-right max-md:text-left`}>
        <Actions user={user} me={me} {...handlers} />
      </td>
    </tr>
  );
}
