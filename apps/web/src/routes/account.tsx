import { AccountPage } from "@/account/AccountPage";
import { AdminGroupsPage } from "@/admin/AdminGroupsPage";
import { AdminServerPage } from "@/admin/AdminServerPage";
import { AdminUsersPage } from "@/admin/AdminUsersPage";
import { useMe } from "@/api/auth";

/** `/account`: the auth gate guarantees someone is signed in by the time this renders. */
export function AccountRoute() {
  const me = useMe().data;
  return me ? <AccountPage me={me} /> : null;
}

/** `/admin/users`: members see a note instead (the server refuses them too). */
export function AdminUsersRoute() {
  const me = useMe().data;
  return me ? <AdminUsersPage me={me} /> : null;
}

/** `/admin/groups`: members see a note instead (the server refuses them too). */
export function AdminGroupsRoute() {
  const me = useMe().data;
  return me ? <AdminGroupsPage me={me} /> : null;
}

/** `/admin/server`: members see a note instead (the server refuses them too). */
export function AdminServerRoute() {
  const me = useMe().data;
  return me ? <AdminServerPage me={me} /> : null;
}
