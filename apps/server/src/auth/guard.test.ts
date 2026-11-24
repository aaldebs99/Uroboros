import type { OpenAPIHono } from "@hono/zod-openapi";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { currentPrincipal } from "../api/principal.ts";
import { digest, newSecret } from "./secrets.ts";
import { createSession } from "./sessions.ts";

let testDb: TestDb;
let app: OpenAPIHono;
/** Bearer secrets the injected token resolver knows, mapped to their owner. */
const tokens = new Map<string, string>();
/** A secret's scopes when not just `api`. */
const scopes = new Map<string, ("api" | "mcp")[]>();

beforeAll(async () => {
  testDb = await TestDb.create();
  app = createApp(
    {
      db: testDb.db,
      version: "t",
      logger: pino({ level: "silent" }),
      auth: {
        secureCookies: false,
        resolveToken: (_db, secret) => {
          const userId = tokens.get(secret);
          return Promise.resolve(
            userId === undefined
              ? null
              : { userId, tokenId: "t", scopes: scopes.get(secret) ?? ["api"], readOnly: false },
          );
        },
      },
    },
    { webDist: null },
  );
  app.get("/api/test/whoami", (c) => c.json(currentPrincipal(c)));
  app.get("/api/mcp/x", (c) => c.json({ ok: true }));
  app.get("/api/mcpx", (c) => c.json({ ok: true }));
  app.post("/api/test/write", (c) => c.json({ ok: true }));
  for (const prefix of ["admin", "me/tokens", "me/password", "me/sessions", "me/push"]) {
    app.get(`/api/${prefix}/x`, (c) => c.json({ ok: true }));
  }
});
afterAll(async () => {
  await testDb.close();
});

const req = (path: string, init: RequestInit = {}) => app.request(path, init);

describe("the API guard", () => {
  it("401s a protected route without credentials and leaves public routes open", async () => {
    expect((await req("/api/test/whoami")).status).toBe(401);
    expect((await req("/api/me/push/x")).status).toBe(401);
    expect((await req("/api/health")).status).toBe(200);
    expect((await req("/api/info")).status).toBe(200);
  });

  it("resolves a session cookie to its user", async () => {
    const s = await signedIn(testDb.db, { username: "alice" });
    const res = await req("/api/test/whoami", { headers: s.headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: s.userId, role: "member", via: "session" });
  });

  it("needs the CSRF header for a cookie write, and accepts it", async () => {
    const s = await signedIn(testDb.db, { username: "bob" });
    const bare = await req("/api/test/write", { method: "POST", headers: { cookie: s.cookie } });
    expect(bare.status).toBe(403);
    const wrong = await req("/api/test/write", {
      method: "POST",
      headers: { cookie: s.cookie, "x-uroboros-csrf": "nope" },
    });
    expect(wrong.status).toBe(403);
    const ok = await req("/api/test/write", { method: "POST", headers: s.headers });
    expect(ok.status).toBe(200);
  });

  it("lets a bearer token write without CSRF", async () => {
    const s = await signedIn(testDb.db, { username: "carol" });
    const secret = newSecret();
    tokens.set(secret, s.userId);
    const res = await req("/api/test/write", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status).toBe(200);
  });

  it("refuses a bearer token on admin, token, password, session, push and site-login routes", async () => {
    const s = await signedIn(testDb.db, { username: "dave", role: "admin" });
    const secret = newSecret();
    tokens.set(secret, s.userId);
    for (const prefix of [
      "admin",
      "me/tokens",
      "me/password",
      "me/sessions",
      "me/push",
      "me/site-logins",
    ]) {
      const res = await req(`/api/${prefix}/x`, { headers: { authorization: `Bearer ${secret}` } });
      expect([prefix, res.status]).toEqual([prefix, 403]);
      expect(await res.json()).toMatchObject({
        message: "an API token cannot be used here; sign in in the browser",
      });
    }
  });

  it("stops a disabled user's session and token at once", async () => {
    const s = await signedIn(testDb.db, { username: "erin" });
    const secret = newSecret();
    tokens.set(secret, s.userId);
    expect((await req("/api/test/whoami", { headers: s.headers })).status).toBe(200);
    await testDb.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", s.userId)
      .execute();
    expect((await req("/api/test/whoami", { headers: s.headers })).status).toBe(401);
    // the token resolver here is a stub; the guard re-checks the owner itself
    const viaToken = await req("/api/test/whoami", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(viaToken.status).toBe(401);
  });

  it("stops a revoked user's session", async () => {
    const s = await signedIn(testDb.db, { username: "frank" });
    await testDb.db
      .updateTable("users")
      .set({ revoked_at: new Date() })
      .where("id", "=", s.userId)
      .execute();
    expect((await req("/api/test/whoami", { headers: s.headers })).status).toBe(401);
  });

  it("401s an expired session", async () => {
    const s = await signedIn(testDb.db, { username: "gina" });
    const expired = await createSession(testDb.db, {
      userId: s.userId,
      ttlHours: 1,
      userAgent: null,
    });
    await testDb.db
      .updateTable("auth_sessions")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("token_hash", "=", digest(expired.token))
      .execute();
    const res = await req("/api/test/whoami", {
      headers: { cookie: `uroboros_session=${expired.token}` },
    });
    expect(res.status).toBe(401);
  });

  it("lets only an MCP token under the MCP path, and keeps it there", async () => {
    const s = await signedIn(testDb.db, { username: "hank" });
    const rest = newSecret();
    tokens.set(rest, s.userId);
    const mcp = newSecret();
    tokens.set(mcp, s.userId);
    scopes.set(mcp, ["mcp"]);
    const get = (path: string, secret: string) =>
      req(path, { headers: { authorization: `Bearer ${secret}` } });
    expect((await get("/api/mcp/x", rest)).status).toBe(403);
    expect((await get("/api/mcp/x", mcp)).status).toBe(200);
    // a lookalike path is an ordinary REST route
    expect((await get("/api/mcpx", mcp)).status).toBe(403);
    expect((await get("/api/mcpx", rest)).status).toBe(200);
    expect((await req("/api/mcp/x", { headers: s.headers })).status).toBe(401);
  });

  it("401s a malformed bearer token", async () => {
    const res = await req("/api/test/whoami", { headers: { authorization: "Bearer not-hex" } });
    expect(res.status).toBe(401);
  });
});
