import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asUser, signedIn } from "../../test/auth.ts";
import { CLIENT_ID, CLIENT_SECRET, startIdp, type TestIdp } from "../../test/oidcIdp.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { URO_OSYN } from "../shared/lockKeys.ts";
import { PgLeaderLock } from "../shared/leader.ts";
import { runSyncPass, type SyncDeps } from "./claimsSync.ts";
import type { OidcConfig } from "./config.ts";
import { saveGrant, upsertOidcUser } from "./oidc/accounts.ts";
import { createOidcProvider, type OidcProvider } from "./oidc/provider.ts";
import { createSession, resolveSession, sweepExpired } from "./sessions.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let idp: TestIdp;
let provider: OidcProvider;
const stop = new AbortController();

const oidc = (): OidcConfig => ({
  issuer: idp.issuer,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  displayName: "Authentik",
  adminGroups: ["authentik Admins"],
  groupsClaim: "groups",
  syncIntervalSecs: 900,
  redirectUrl: "https://uro.example/api/auth/oidc/callback",
});

const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({
  db: testDb.db,
  provider,
  databaseUrl: testDb.url,
  logger,
  ...over,
});

beforeAll(async () => {
  testDb = await TestDb.create();
  idp = await startIdp();
  provider = createOidcProvider(oidc(), { logger, fetch: idp.fetch });
  provider.start(stop.signal);
  await vi.waitFor(
    () => {
      expect(provider.ready()).toBe(true);
    },
    { timeout: 10_000 },
  );
});
afterAll(async () => {
  stop.abort();
  await idp.close();
  await testDb.close();
});
beforeEach(() => {
  idp.refuseRefresh(false);
  idp.down(false);
  idp.refreshIdToken(true);
  idp.userinfoFails(null);
  idp.onRefresh(null);
});

/** An SSO user whose claims are stale and who holds a working refresh token. */
async function staleUser(sub: string, groups: string[] = [], ageMs = 3_600_000): Promise<string> {
  const { id } = await upsertOidcUser(testDb.db, {
    issuer: idp.issuer,
    subject: sub,
    displayName: sub,
    email: null,
    groups,
    role: groups.includes("authentik Admins") ? "admin" : "member",
  });
  await testDb.db
    .updateTable("users")
    .set({ claims_synced_at: new Date(Date.now() - ageMs) })
    .where("id", "=", id)
    .execute();
  await testDb.db
    .insertInto("oidc_grants")
    .values({ user_id: id, refresh_token: idp.issueRefresh({ sub, groups }) })
    .execute();
  return id;
}

const grantOf = async (id: string) =>
  (
    await testDb.db
      .selectFrom("oidc_grants")
      .select("refresh_token")
      .where("user_id", "=", id)
      .executeTakeFirstOrThrow()
  ).refresh_token;

const user = (id: string) =>
  testDb.db
    .selectFrom("users")
    .select(["role", "groups", "revoked_at", "claims_synced_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

describe("claims sync", () => {
  it("promotes a member the provider put in the admin group", async () => {
    const id = await staleUser(`s-${randomUUID()}`);
    idp.setGroups(
      (
        await testDb.db
          .selectFrom("users")
          .select("oidc_subject")
          .where("id", "=", id)
          .executeTakeFirstOrThrow()
      ).oidc_subject ?? "",
      ["authentik Admins"],
    );
    expect(await runSyncPass(deps())).toBe("done");
    const row = await user(id);
    expect(row.role).toBe("admin");
    expect(row.groups).toEqual(["authentik Admins"]);
  });

  it("revokes a user the provider refuses, and their sessions stop", async () => {
    const id = await staleUser(`s-${randomUUID()}`, ["authentik Admins"]);
    const session = await createSession(testDb.db, { userId: id, ttlHours: 1, userAgent: null });
    idp.refuseRefresh(true);
    await runSyncPass(deps());
    const row = await user(id);
    expect(row.role).toBe("member");
    expect(row.groups).toEqual([]);
    expect(row.revoked_at).not.toBeNull();
    expect(await resolveSession(testDb.db, session.token)).toBeNull();
  });

  it("clears the revocation on the user's next real sign-in", async () => {
    const sub = `s-${randomUUID()}`;
    const id = await staleUser(sub);
    idp.refuseRefresh(true);
    await runSyncPass(deps());
    expect((await user(id)).revoked_at).not.toBeNull();
    await upsertOidcUser(testDb.db, {
      issuer: idp.issuer,
      subject: sub,
      displayName: sub,
      email: null,
      groups: [],
      role: "member",
    });
    expect((await user(id)).revoked_at).toBeNull();
  });

  it("changes nothing while the provider is down", async () => {
    const id = await staleUser(`s-${randomUUID()}`, ["authentik Admins"]);
    const before = await user(id);
    idp.down(true);
    await runSyncPass(deps());
    expect(await user(id)).toEqual(before);
  });

  it("skips users whose claims are fresh", async () => {
    const id = await staleUser(`s-${randomUUID()}`);
    await testDb.db
      .updateTable("users")
      .set({ claims_synced_at: new Date() })
      .where("id", "=", id)
      .execute();
    const before = await grantOf(id);
    await runSyncPass(deps());
    expect(await grantOf(id)).toBe(before);
  });

  it("reports busy while another replica holds the sync lock", async () => {
    const holder = await new PgLeaderLock(testDb.url, URO_OSYN, { logger }).tryAcquire();
    try {
      expect(await runSyncPass(deps())).toBe("busy");
    } finally {
      await holder?.release();
    }
  });

  it("falls back to userinfo when a refresh carries no ID token", async () => {
    const sub = `s-${randomUUID()}`;
    const id = await staleUser(sub);
    idp.setGroups(sub, ["authentik Admins"]);
    idp.refreshIdToken(false);
    expect(await runSyncPass(deps())).toBe("done");
    expect((await user(id)).role).toBe("admin");
  });

  it("keeps the rotated refresh token when the claims update fails, so the next pass works", async () => {
    const sub = `s-${randomUUID()}`;
    const id = await staleUser(sub);
    const before = await grantOf(id);
    idp.refreshIdToken(false);
    idp.userinfoFails(sub);
    expect(await runSyncPass(deps())).toBe("done");
    expect(await grantOf(id)).not.toBe(before);
    idp.userinfoFails(null);
    idp.setGroups(sub, ["authentik Admins"]);
    expect(await runSyncPass(deps())).toBe("done");
    const row = await user(id);
    expect(row.revoked_at).toBeNull();
    expect(row.role).toBe("admin");
  });

  it("carries on with the next user when one user's refresh fails", async () => {
    const broken = `s-${randomUUID()}`;
    await staleUser(broken, [], 7_200_000);
    const fine = `s-${randomUUID()}`;
    const id = await staleUser(fine);
    idp.refreshIdToken(false);
    idp.userinfoFails(broken);
    idp.setGroups(fine, ["authentik Admins"]);
    expect(await runSyncPass(deps())).toBe("done");
    expect((await user(id)).role).toBe("admin");
  });

  it("refreshes users whose claims are fresh when forced", async () => {
    const sub = `s-${randomUUID()}`;
    const id = await staleUser(sub, [], 0);
    idp.setGroups(sub, ["authentik Admins"]);
    await runSyncPass(deps());
    expect((await user(id)).role).toBe("member");
    expect(await runSyncPass(deps(), { force: true })).toBe("done");
    expect((await user(id)).role).toBe("admin");
  });

  it("does not revoke a user who signed in again while their old token was refused", async () => {
    const sub = `s-${randomUUID()}`;
    const id = await staleUser(sub);
    const fresh = idp.issueRefresh({ sub });
    idp.onRefresh(async () => {
      await saveGrant(testDb.db, id, fresh);
    });
    idp.refuseRefresh(true);
    expect(await runSyncPass(deps())).toBe("done");
    expect((await user(id)).revoked_at).toBeNull();
    expect(await grantOf(id)).toBe(fresh);
  });

  it("recomputes roles from stored groups when the admin groups change, without the provider", async () => {
    const id = await staleUser(`s-${randomUUID()}`, ["media admins"]);
    await testDb.db
      .updateTable("users")
      .set({ claims_synced_at: new Date() })
      .where("id", "=", id)
      .execute();
    const p = createOidcProvider(
      { ...oidc(), adminGroups: ["media admins"] },
      { logger, fetch: idp.fetch },
    );
    const s = new AbortController();
    p.start(s.signal);
    await vi.waitFor(
      () => {
        expect(p.ready()).toBe(true);
      },
      { timeout: 10_000 },
    );
    const before = await grantOf(id);
    await runSyncPass(deps({ provider: p }));
    s.abort();
    expect((await user(id)).role).toBe("admin");
    expect(await grantOf(id)).toBe(before);
  });
});

describe("POST /api/admin/users/oidc-sync", () => {
  const app = () =>
    createApp(
      {
        db: testDb.db,
        version: "t",
        logger,
        auth: {
          secureCookies: false,
          oidc: provider,
          databaseUrl: testDb.url,
          settings: {
            sessionTtlHours: 1,
            trustProxy: false,
            local: { enabled: true, bootstrap: null },
            oidc: oidc(),
          },
        },
      },
      { webDist: null },
    );

  it("runs a pass for an admin (204), 409s while one runs, 403s for a member", async () => {
    const admin = await signedIn(testDb.db, {
      username: `adm${randomUUID().slice(0, 8)}`,
      role: "admin",
    });
    const member = await signedIn(testDb.db, { username: `mem${randomUUID().slice(0, 8)}` });
    const post = (s: typeof admin) =>
      asUser(app(), s).request("/api/admin/users/oidc-sync", { method: "POST" });
    expect((await post(admin)).status).toBe(204);
    const holder = await new PgLeaderLock(testDb.url, URO_OSYN, { logger }).tryAcquire();
    try {
      expect((await post(admin)).status).toBe(409);
    } finally {
      await holder?.release();
    }
    expect((await post(member)).status).toBe(403);
  });

  it("refreshes every SSO user, even one whose claims are fresh", async () => {
    const admin = await signedIn(testDb.db, {
      username: `adm${randomUUID().slice(0, 8)}`,
      role: "admin",
    });
    const sub = `s-${randomUUID()}`;
    const id = await staleUser(sub, [], 0);
    idp.setGroups(sub, ["authentik Admins"]);
    const res = await asUser(app(), admin).request("/api/admin/users/oidc-sync", {
      method: "POST",
    });
    expect(res.status).toBe(204);
    expect((await user(id)).role).toBe("admin");
  });
});

describe("sweeper", () => {
  it("deletes expired sessions and pending logins, and nothing live", async () => {
    const live = await signedIn(testDb.db, { username: `live${randomUUID().slice(0, 8)}` });
    const dead = await createSession(testDb.db, {
      userId: live.userId,
      ttlHours: 1,
      userAgent: null,
    });
    await testDb.db
      .updateTable("auth_sessions")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("csrf", "=", dead.csrf)
      .execute();
    await testDb.db
      .insertInto("auth_logins")
      .values({
        state_hash: Buffer.alloc(32, 9),
        binding_hash: Buffer.alloc(32, 8),
        nonce: "n",
        pkce_verifier: "v",
        return_to: "/",
        expires_at: new Date(Date.now() - 1000),
      })
      .execute();
    expect(await sweepExpired(testDb.db)).toBeGreaterThanOrEqual(2);
    expect(await resolveSession(testDb.db, live.token)).not.toBeNull();
    expect(await resolveSession(testDb.db, dead.token)).toBeNull();
  });
});
