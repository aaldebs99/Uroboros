import { AccountPage } from "@/account/AccountPage";
import { AdminUsersPage } from "@/admin/AdminUsersPage";
import { ProfilesPage } from "@/admin/ProfilesPage";
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

/** `/admin/format-profiles`: members see a note instead (the server refuses them too). */
export function AdminProfilesRoute() {
  const me = useMe().data;
  return me ? <ProfilesPage me={me} /> : null;
}
