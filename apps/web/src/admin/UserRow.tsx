import { MIN_PASSWORD_CHARS, type AdminUser, type Me } from "@uroboros/contract";
import { toast } from "sonner";

import { useDeleteUser, usePatchUser, useResetPassword } from "@/api/account";
import { errorText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const when = (iso: string | null) => (iso === null ? "never" : new Date(iso).toLocaleString());
const fail = (what: string) => (error: unknown) => {
  toast.error(`Could not ${what}: ${errorText(error)}`);
};
const roleName = (user: AdminUser) => (user.role === "admin" ? "Admin" : "Member");

function RoleCell({ user }: { user: AdminUser }) {
  if (user.method === "local") return <Badge variant="secondary">{roleName(user)}</Badge>;
  return (
    <span className="flex flex-col">
      <Badge variant="secondary">{roleName(user)}</Badge>
      <span className="text-xs text-muted-foreground">Set by Authentik groups</span>
    </span>
  );
}

function StateCell({ user }: { user: AdminUser }) {
  return (
    <>
      {user.disabled ? <Badge variant="destructive">Disabled</Badge> : null}
      {user.revoked ? <Badge variant="warning">Revoked by Authentik</Badge> : null}
      {user.isBootstrap ? <Badge variant="outline">Bootstrap</Badge> : null}
    </>
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

function Actions({ user, me }: { user: AdminUser; me: Me }) {
  const patch = usePatchUser();
  const reset = useResetPassword();
  const remove = useDeleteUser();
  const may = allowed(user, me);
  const name = user.displayName;
  const toAdmin = user.role !== "admin";

  const resetPassword = () => {
    const password = window.prompt(
      `New password for ${name} (${String(MIN_PASSWORD_CHARS)}+ characters)`,
    );
    if (password === null) return;
    if (password.length < MIN_PASSWORD_CHARS) {
      toast.error(`The password needs at least ${String(MIN_PASSWORD_CHARS)} characters.`);
      return;
    }
    reset.mutate(
      { id: user.id, password },
      {
        onSuccess: () => toast.success(`${name} was signed out everywhere.`),
        onError: fail("reset the password"),
      },
    );
  };

  return (
    <>
      {may.changeRole ? (
        <Button
          variant="ghost"
          size="sm"
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
          variant="ghost"
          size="sm"
          aria-label={`Reset password for ${name}`}
          onClick={resetPassword}
        >
          Reset password
        </Button>
      ) : null}
      {may.disable ? (
        <Button
          variant="ghost"
          size="sm"
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
          variant="ghost"
          size="sm"
          className="text-destructive"
          aria-label={`Delete ${name}`}
          onClick={() => {
            if (window.confirm(`Delete ${name}? This cannot be undone.`)) {
              remove.mutate(user.id, { onError: fail("delete the user") });
            }
          }}
        >
          Delete
        </Button>
      ) : null}
    </>
  );
}

/** One user in Admin › Users. */
export function UserRow({ user, me }: { user: AdminUser; me: Me }) {
  return (
    <tr className="border-b align-middle">
      <td className="py-3 pr-3 font-medium">{user.displayName}</td>
      <td className="py-3 pr-3 text-muted-foreground">{user.username ?? "SSO"}</td>
      <td className="py-3 pr-3">
        <RoleCell user={user} />
      </td>
      <td className="py-3 pr-3 text-xs text-muted-foreground">{when(user.lastLoginAt)}</td>
      <td className="py-3 pr-3">
        <StateCell user={user} />
      </td>
      <td className="py-3 text-right whitespace-nowrap">
        <Actions user={user} me={me} />
      </td>
    </tr>
  );
}
