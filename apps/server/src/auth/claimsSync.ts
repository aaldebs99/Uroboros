import { sql, type Kysely } from "kysely";
import * as client from "openid-client";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { PgLeaderLock } from "../shared/leader.ts";
import { URO_OSYN } from "../shared/lockKeys.ts";
import { groupsFrom, roleFor } from "./oidc/accounts.ts";
import type { OidcProvider } from "./oidc/provider.ts";

export interface SyncDeps {
  db: Kysely<Database>;
  provider: OidcProvider;
  /** For the per-pass advisory lock's own connection. */
  databaseUrl: string;
  logger: Logger;
}

/** First pass after start, then every tick. */
export const FIRST_PASS_MS = 15_000;
export const TICK_MS = 60_000;

/** A refresh the provider refused: the user was removed or their grant revoked. */
function isInvalidGrant(err: unknown): boolean {
  return err instanceof client.ResponseBodyError && err.error === "invalid_grant";
}

/** Re-derives every SSO user's role from their stored groups (the admin groups may have changed). */
async function recomputeRoles(deps: SyncDeps): Promise<void> {
  const { adminGroups } = deps.provider.settings;
  const users = await deps.db
    .selectFrom("users")
    .select(["id", "groups", "role"])
    .where("oidc_subject", "is not", null)
    .where("revoked_at", "is", null)
    .execute();
  for (const u of users) {
    const role = roleFor(u.groups, adminGroups);
    if (role !== u.role) {
      await deps.db.updateTable("users").set({ role }).where("id", "=", u.id).execute();
    }
  }
}

interface SyncUser {
  id: string;
  /** The token this pass redeems; every write below is guarded on it still being the stored one. */
  refresh_token: string;
  oidc_subject: string;
}

/**
 * The provider refused the grant: revoke the user, unless a sign-in replaced the grant while the
 * refresh was in flight (then the refusal is about a token nobody holds any more).
 */
async function revoke(deps: SyncDeps, user: SyncUser): Promise<void> {
  const revoked = await deps.db.transaction().execute(async (tx) => {
    const held = await tx
      .deleteFrom("oidc_grants")
      .where("user_id", "=", user.id)
      .where("refresh_token", "=", user.refresh_token)
      .returning("user_id")
      .executeTakeFirst();
    if (held === undefined) return false;
    await tx
      .updateTable("users")
      .set({ role: "member", groups: JSON.stringify([]), revoked_at: new Date() })
      .where("id", "=", user.id)
      .execute();
    return true;
  });
  if (revoked) {
    deps.logger.info({ userId: user.id }, "claims sync: provider refused the grant; user revoked");
  }
}

async function applyClaims(
  deps: SyncDeps,
  userId: string,
  claims: Record<string, unknown>,
): Promise<void> {
  const { groupsClaim, adminGroups } = deps.provider.settings;
  const groups = groupsFrom(claims, groupsClaim);
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
  await deps.db
    .updateTable("users")
    .set({
      groups: JSON.stringify(groups),
      role: roleFor(groups, adminGroups),
      claims_synced_at: new Date(),
      ...(str(claims.name) === undefined ? {} : { display_name: str(claims.name)?.slice(0, 128) }),
      ...(str(claims.email) === undefined ? {} : { email: str(claims.email) }),
    })
    .where("id", "=", userId)
    .execute();
}

async function refreshOne(
  deps: SyncDeps,
  config: client.Configuration,
  user: SyncUser,
): Promise<void> {
  let tokens: Awaited<ReturnType<typeof client.refreshTokenGrant>>;
  try {
    tokens = await client.refreshTokenGrant(config, user.refresh_token);
  } catch (err) {
    if (isInvalidGrant(err)) {
      await revoke(deps, user);
      return;
    }
    deps.logger.warn({ err, userId: user.id }, "claims sync: provider unreachable; keeping claims");
    return;
  }
  // Store a rotated token before anything else can fail: the old one is already spent.
  if (tokens.refresh_token !== undefined) {
    await deps.db
      .updateTable("oidc_grants")
      .set({ refresh_token: tokens.refresh_token, updated_at: new Date() })
      .where("user_id", "=", user.id)
      .where("refresh_token", "=", user.refresh_token)
      .execute();
  }
  // A refresh may omit the ID token; then the userinfo endpoint answers for the same subject.
  const claims: Record<string, unknown> =
    tokens.claims() ?? (await client.fetchUserInfo(config, tokens.access_token, user.oidc_subject));
  await applyClaims(deps, user.id, claims);
}

export interface SyncPassOptions {
  /** Refresh every SSO user, not only those whose claims are older than the interval ("Sync now"). */
  force?: boolean;
}

/**
 * One pass, under a per-pass advisory lock so only one replica redeems refresh tokens at a time.
 * "skipped" when OIDC is not ready, or sync is off and the pass is not forced; "busy" when another
 * replica holds the lock. One user's failure is logged and the pass moves on to the next.
 */
export async function runSyncPass(
  deps: SyncDeps,
  opts: SyncPassOptions = {},
): Promise<"done" | "busy" | "skipped"> {
  const force = opts.force ?? false;
  const config = deps.provider.configuration();
  const interval = deps.provider.settings.syncIntervalSecs;
  if (config === null || (interval === 0 && !force)) return "skipped";
  const guard = await new PgLeaderLock(deps.databaseUrl, URO_OSYN, {
    logger: deps.logger,
  }).tryAcquire();
  if (guard === null) return "busy";
  try {
    await recomputeRoles(deps);
    const due = await deps.db
      .selectFrom("oidc_grants as g")
      .innerJoin("users as u", "u.id", "g.user_id")
      .select(["u.id", "g.refresh_token", "u.oidc_subject"])
      .where("u.disabled_at", "is", null)
      .where("u.oidc_subject", "is not", null)
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb("u.claims_synced_at", "is", null),
            eb("u.claims_synced_at", "<", sql<Date>`now() - make_interval(secs => ${interval})`),
          ]),
        ),
      )
      .orderBy(sql`u.claims_synced_at asc nulls first`)
      .execute();
    for (const { id, refresh_token, oidc_subject } of due) {
      if (guard.isLost) break;
      if (oidc_subject === null) continue;
      try {
        await refreshOne(deps, config, { id, refresh_token, oidc_subject });
      } catch (err) {
        deps.logger.warn({ err, userId: id }, "claims sync: refreshing this user failed");
      }
    }
    return "done";
  } finally {
    await guard.release();
  }
}

/** Ticks on every replica: first after 15 s, then every 60 s, until `signal` aborts. */
export function startClaimsSync(deps: SyncDeps, signal: AbortSignal): void {
  // An abort that already fired never reaches the listeners below.
  if (signal.aborted) return;
  const tick = () => {
    runSyncPass(deps).catch((err: unknown) => {
      deps.logger.error({ err }, "claims sync pass failed");
    });
  };
  const first = setTimeout(() => {
    tick();
    const every = setInterval(tick, TICK_MS);
    signal.addEventListener(
      "abort",
      () => {
        clearInterval(every);
      },
      { once: true },
    );
  }, FIRST_PASS_MS);
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(first);
    },
    { once: true },
  );
}
