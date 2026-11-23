import type { Kysely } from "kysely";
import type { Database } from "../../db/schema.ts";

export type Role = "admin" | "member";

/** Admin when any of the user's groups is an admin group (exact match). */
export function roleFor(groups: readonly string[], adminGroups: readonly string[]): Role {
  return groups.some((g) => adminGroups.includes(g)) ? "admin" : "member";
}

/** The string groups in `claims[claim]`; anything else is no groups. */
export function groupsFrom(claims: Record<string, unknown>, claim: string): string[] {
  const value = claims[claim];
  return Array.isArray(value) ? value.filter((g): g is string => typeof g === "string") : [];
}

export interface OidcIdentity {
  issuer: string;
  subject: string;
  displayName: string;
  email: string | null;
  groups: string[];
  role: Role;
}

/**
 * Finds or creates the account for an OIDC identity. A disabled account is reported without being
 * touched; otherwise profile, groups and role are refreshed, the revocation cleared and the
 * sign-in stamped.
 */
export async function upsertOidcUser(
  db: Kysely<Database>,
  identity: OidcIdentity,
): Promise<{ id: string; disabled: boolean }> {
  const existing = await db
    .selectFrom("users")
    .select(["id", "disabled_at"])
    .where("oidc_issuer", "=", identity.issuer)
    .where("oidc_subject", "=", identity.subject)
    .executeTakeFirst();
  if (existing?.disabled_at != null) return { id: existing.id, disabled: true };
  const now = new Date();
  const fields = {
    display_name: identity.displayName,
    email: identity.email,
    groups: JSON.stringify(identity.groups),
    role: identity.role,
    revoked_at: null,
    claims_synced_at: now,
    last_login_at: now,
  };
  if (existing !== undefined) {
    await db.updateTable("users").set(fields).where("id", "=", existing.id).execute();
    return { id: existing.id, disabled: false };
  }
  const row = await db
    .insertInto("users")
    .values({ ...fields, oidc_issuer: identity.issuer, oidc_subject: identity.subject })
    .onConflict((oc) =>
      oc
        .columns(["oidc_issuer", "oidc_subject"])
        .where("oidc_subject", "is not", null)
        .doUpdateSet(fields),
    )
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: row.id, disabled: false };
}

/** Saves the user's latest refresh token for the claims sync. */
export async function saveGrant(
  db: Kysely<Database>,
  userId: string,
  refreshToken: string,
): Promise<void> {
  await db
    .insertInto("oidc_grants")
    .values({ user_id: userId, refresh_token: refreshToken })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({ refresh_token: refreshToken, updated_at: new Date() }),
    )
    .execute();
}

/** Drops the stored refresh token (a sign-in that brought none). */
export async function forgetGrant(db: Kysely<Database>, userId: string): Promise<void> {
  await db.deleteFrom("oidc_grants").where("user_id", "=", userId).execute();
}
