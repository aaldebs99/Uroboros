import type { OpenAPIHono } from "@hono/zod-openapi";
import { AdminUser, SessionView } from "@uroboros/contract";
import type { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { createSession, resolveSession } from "./sessions.ts";

const logger = pino({ level: "silent" });
const OLD = "the old password!";
const NEW = "a brand new password";

let testDb: TestDb;
let app: OpenAPIHono;
let n = 0;

beforeAll(async () => {
  testDb = await TestDb.create();
  app = createApp(
    { db: testDb.db, valkey: {} as Redis, version: "t", logger, auth: { secureCookies: false } },
    { webDist: null },
  );
});
afterAll(async () => {
  await testDb.close();
});

/** A signed-in local user with password OLD. */
async function localUser(role: "admin" | "member" = "member"): Promise<SignedIn> {
  n++;
  const u = await signedIn(testDb.db, { username: `u${String(n)}`, role });
  await testDb.db
    .updateTable("users")
    .set({ password_hash: await hashPassword(OLD) })
    .where("id", "=", u.userId)
    .execute();
  return u;
}

async function ssoUser(): Promise<string> {
  n++;
  const row = await testDb.db
    .insertInto("users")
    .values({
      oidc_issuer: "https://sso.example",
      oidc_subject: `sub${String(n)}`,
      display_name: "Sso",
      role: "member",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const send = (u: SignedIn, method: string, path: string, body?: unknown) =>
  asUser(app, u).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const passwordOf = async (id: string) =>
  (
    await testDb.db
      .selectFrom("users")
      .select("password_hash")
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
  ).password_hash ?? "";

describe("POST /api/me/password", () => {
  it("refuses a wrong current password", async () => {
    const u = await localUser();
    const res = await send(u, "POST", "/api/me/password", {
      currentPassword: "nope",
      newPassword: NEW,
    });
    // 403, not 401: the session is fine, and a 401 sends the web app back to sign-in
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("changes it and signs out the other sessions, keeping this one", async () => {
    const u = await localUser();
    const other = await createSession(testDb.db, {
      userId: u.userId,
      ttlHours: 1,
      userAgent: null,
    });
    const res = await send(u, "POST", "/api/me/password", {
      currentPassword: OLD,
      newPassword: NEW,
    });
    expect(res.status).toBe(204);
    expect(await verifyPassword(await passwordOf(u.userId), NEW)).toBe(true);
    expect(await resolveSession(testDb.db, other.token)).toBeNull();
    expect(await resolveSession(testDb.db, u.token)).not.toBeNull();
  });

  it("409s for an SSO user", async () => {
    const id = await ssoUser();
    const s = await createSession(testDb.db, { userId: id, ttlHours: 1, userAgent: null });
    const sso: SignedIn = {
      userId: id,
      token: s.token,
      csrf: s.csrf,
      cookie: `uroboros_session=${s.token}; uroboros_csrf=${s.csrf}`,
      headers: {
        cookie: `uroboros_session=${s.token}; uroboros_csrf=${s.csrf}`,
        "x-uroboros-csrf": s.csrf,
      },
    };
    const res = await send(sso, "POST", "/api/me/password", {
      currentPassword: "x",
      newPassword: NEW,
    });
    expect(res.status).toBe(409);
  });
});

describe("/api/me/sessions", () => {
  it("lists the caller's sessions with the current one marked", async () => {
    const u = await localUser();
    await createSession(testDb.db, { userId: u.userId, ttlHours: 1, userAgent: "Firefox" });
    const list = SessionView.array().parse(await (await send(u, "GET", "/api/me/sessions")).json());
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.some((s) => s.userAgent === "Firefox")).toBe(true);
  });

  it("signs out one other session, then all the others", async () => {
    const u = await localUser();
    const a = await createSession(testDb.db, { userId: u.userId, ttlHours: 1, userAgent: "A" });
    const b = await createSession(testDb.db, { userId: u.userId, ttlHours: 1, userAgent: "B" });
    const list = SessionView.array().parse(await (await send(u, "GET", "/api/me/sessions")).json());
    const idA = list.find((s) => s.userAgent === "A")?.id ?? "";
    expect((await send(u, "DELETE", `/api/me/sessions/${idA}`)).status).toBe(204);
    expect(await resolveSession(testDb.db, a.token)).toBeNull();
    expect(await resolveSession(testDb.db, b.token)).not.toBeNull();
    expect((await send(u, "DELETE", "/api/me/sessions")).status).toBe(204);
    expect(await resolveSession(testDb.db, b.token)).toBeNull();
    expect(await resolveSession(testDb.db, u.token)).not.toBeNull();
  });

  it("404s another user's session id", async () => {
    const owner = await localUser();
    const other = await localUser();
    const list = SessionView.array().parse(
      await (await send(owner, "GET", "/api/me/sessions")).json(),
    );
    expect((await send(other, "DELETE", `/api/me/sessions/${list[0]?.id ?? ""}`)).status).toBe(404);
  });
});

describe("/api/admin/users", () => {
  it("is for admins only", async () => {
    const member = await localUser();
    expect((await send(member, "GET", "/api/admin/users")).status).toBe(403);
  });

  it("lists users and creates a local one (409 on a taken username)", async () => {
    const admin = await localUser("admin");
    const body = { username: "tv", displayName: "Living room", role: "member", password: NEW };
    const res = await send(admin, "POST", "/api/admin/users", body);
    expect(res.status).toBe(200);
    expect(AdminUser.parse(await res.json())).toMatchObject({
      username: "tv",
      method: "local",
      role: "member",
    });
    expect((await send(admin, "POST", "/api/admin/users", body)).status).toBe(409);
    const list = AdminUser.array().parse(
      await (await send(admin, "GET", "/api/admin/users")).json(),
    );
    expect(list.some((u) => u.username === "tv")).toBe(true);
  });

  it("changes a local user's role but not an SSO user's", async () => {
    const admin = await localUser("admin");
    const target = await localUser();
    const ok = await send(admin, "PATCH", `/api/admin/users/${target.userId}`, { role: "admin" });
    expect(AdminUser.parse(await ok.json()).role).toBe("admin");
    const sso = await ssoUser();
    const refused = await send(admin, "PATCH", `/api/admin/users/${sso}`, { role: "admin" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ message: "role comes from Authentik groups" });
  });

  it("disables and re-enables users, but never itself or the bootstrap admin", async () => {
    const admin = await localUser("admin");
    const target = await localUser();
    const off = await send(admin, "PATCH", `/api/admin/users/${target.userId}`, { disabled: true });
    expect(AdminUser.parse(await off.json()).disabled).toBe(true);
    expect(await resolveSession(testDb.db, target.token)).toBeNull();
    const on = await send(admin, "PATCH", `/api/admin/users/${target.userId}`, { disabled: false });
    expect(AdminUser.parse(await on.json()).disabled).toBe(false);

    expect(
      (await send(admin, "PATCH", `/api/admin/users/${admin.userId}`, { disabled: true })).status,
    ).toBe(409);
    expect(
      (await send(admin, "PATCH", `/api/admin/users/${admin.userId}`, { role: "member" })).status,
    ).toBe(409);
    const boot = await localUser("admin");
    await testDb.db.updateTable("users").set({ bootstrap: false }).execute();
    await testDb.db
      .updateTable("users")
      .set({ bootstrap: true })
      .where("id", "=", boot.userId)
      .execute();
    expect(
      (await send(admin, "PATCH", `/api/admin/users/${boot.userId}`, { disabled: true })).status,
    ).toBe(409);

    const sso = await ssoUser();
    expect((await send(admin, "PATCH", `/api/admin/users/${sso}`, { disabled: true })).status).toBe(
      200,
    );
  });

  it("resets a local user's password and signs them out everywhere", async () => {
    const admin = await localUser("admin");
    const target = await localUser();
    const res = await send(admin, "POST", `/api/admin/users/${target.userId}/password`, {
      password: NEW,
    });
    expect(res.status).toBe(204);
    expect(await verifyPassword(await passwordOf(target.userId), NEW)).toBe(true);
    expect(await resolveSession(testDb.db, target.token)).toBeNull();
    expect(
      (await send(admin, "POST", `/api/admin/users/${await ssoUser()}/password`, { password: NEW }))
        .status,
    ).toBe(409);
  });

  it("deletes local users only, and never itself or the bootstrap admin", async () => {
    const admin = await localUser("admin");
    const target = await localUser();
    expect((await send(admin, "DELETE", `/api/admin/users/${target.userId}`)).status).toBe(204);
    expect((await send(admin, "DELETE", `/api/admin/users/${target.userId}`)).status).toBe(404);
    const sso = await send(admin, "DELETE", `/api/admin/users/${await ssoUser()}`);
    expect(sso.status).toBe(409);
    expect(await sso.json()).toMatchObject({
      message: "disable SSO accounts instead; they come back on next sign-in",
    });
    expect((await send(admin, "DELETE", `/api/admin/users/${admin.userId}`)).status).toBe(409);
  });
});
