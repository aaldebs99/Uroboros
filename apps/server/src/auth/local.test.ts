import type { OpenAPIHono } from "@hono/zod-openapi";
import { AuthMethods, LogoutResult, Me } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import type { AuthConfig } from "./config.ts";
import { hashPassword } from "./passwords.ts";

const logger = pino({ level: "silent" });
const PASSWORD = "correct horse battery";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await TestDb.create();
  await testDb.db
    .insertInto("users")
    .values({
      username: "alice",
      password_hash: await hashPassword(PASSWORD),
      display_name: "Alice",
      email: "alice@example.org",
      role: "member",
    })
    .execute();
});
// The counters are shared through the database, as across replicas: every test starts clean.
beforeEach(async () => {
  await testDb.db.deleteFrom("signin_failures").execute();
});
afterAll(async () => {
  await testDb.close();
});

const settings = (over: Partial<AuthConfig> = {}): AuthConfig => ({
  sessionTtlHours: 720,
  trustProxy: false,
  local: { enabled: true, bootstrap: null },
  oidc: null,
  ...over,
});

/** A fresh app; `secure` marks cookies Secure. */
function app(over: Partial<AuthConfig> = {}, secure = false): OpenAPIHono {
  return createApp(
    {
      db: testDb.db,
      version: "t",
      logger,
      auth: {
        secureCookies: secure,
        settings: settings(over),
      },
    },
    { webDist: null },
  );
}

const login = (
  a: OpenAPIHono,
  username: string,
  password: string,
  headers: Record<string, string> = {},
) =>
  a.request("/api/auth/local/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ username, password }),
  });

/** `name=value` pairs from Set-Cookie headers, plus each raw header. */
function cookies(res: Response): {
  jar: string;
  raw: string[];
  get(name: string): string | undefined;
} {
  const raw = res.headers.getSetCookie();
  const pairs = raw.map((h) => h.split(";")[0] ?? "");
  return {
    raw,
    jar: pairs.join("; "),
    get: (name) => pairs.find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1),
  };
}

describe("local sign-in", () => {
  it("signs in, setting a Strict HttpOnly session cookie and a readable CSRF cookie", async () => {
    const res = await login(app(), "alice", PASSWORD);
    expect(res.status).toBe(204);
    const { raw } = cookies(res);
    const session = raw.find((h) => h.startsWith("uroboros_session="));
    const csrf = raw.find((h) => h.startsWith("uroboros_csrf="));
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Strict/);
    expect(session).toMatch(/Path=\//);
    expect(session).not.toMatch(/Secure/);
    expect(csrf).not.toMatch(/HttpOnly/);
  });

  it("marks cookies Secure behind an https public URL", async () => {
    const res = await login(app({}, true), "alice", PASSWORD);
    expect(cookies(res).raw.every((h) => /Secure/.test(h))).toBe(true);
  });

  it("marks cookies Secure when a trusted proxy says the request came over https", async () => {
    const proto = { "x-forwarded-proto": "https" };
    const trusted = await login(app({ trustProxy: true }), "alice", PASSWORD, proto);
    expect(cookies(trusted).raw.every((h) => /Secure/.test(h))).toBe(true);
    const untrusted = await login(app({ trustProxy: false }), "alice", PASSWORD, proto);
    expect(cookies(untrusted).raw.some((h) => /Secure/.test(h))).toBe(false);
  });

  it("matches the username case-insensitively and trims it", async () => {
    expect((await login(app(), "  Alice ", PASSWORD)).status).toBe(204);
  });

  it("answers a wrong password and an unknown user the same way", async () => {
    const a = app();
    const wrong = await login(a, "alice", "nope nope nope");
    const unknown = await login(a, "mallory", "nope nope nope");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("takes about as long for an unknown user as for a wrong password", async () => {
    const a = app();
    const time = async (username: string) => {
      const start = performance.now();
      await login(a, username, "nope nope nope");
      return performance.now() - start;
    };
    const median = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? 0;
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 4; i++) {
      known.push(await time("alice"));
      unknown.push(await time(`ghost${String(i)}`));
    }
    const ratio = median(unknown) / median(known);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  it("locks a username after 5 failures from one address in 15 minutes, shared across app instances", async () => {
    const make = () =>
      createApp(
        {
          db: testDb.db,
          version: "t",
          logger,
          auth: { secureCookies: false, settings: settings() },
        },
        { webDist: null },
      );
    const [one, two] = [make(), make()];
    for (let i = 0; i < 5; i++) {
      expect((await login(i % 2 === 0 ? one : two, "alice", "wrong password!")).status).toBe(401);
    }
    const locked = await login(two, "alice", PASSWORD);
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ code: "too_many_requests" });
  });

  it("doesn't let one address's failures lock the account out from another", async () => {
    const a = app({ trustProxy: true });
    const attacker = { "x-forwarded-for": "203.0.113.50" };
    for (let i = 0; i < 6; i++) await login(a, "alice", "wrong password!", attacker);
    expect((await login(a, "alice", PASSWORD, attacker)).status).toBe(429);
    expect((await login(a, "alice", PASSWORD, { "x-forwarded-for": "203.0.113.51" })).status).toBe(
      204,
    );
  });

  it("lets at most 5 guesses through when they arrive at once", async () => {
    const a = app();
    const results = await Promise.all(
      Array.from({ length: 12 }, async () => login(a, "alice", "wrong password!")),
    );
    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(7);
  });

  it("does not count a successful sign-in against the client IP", async () => {
    const a = app({ trustProxy: true });
    const from = { "x-forwarded-for": "203.0.113.20" };
    for (let i = 0; i < 31; i++) {
      expect((await login(a, "alice", PASSWORD, from)).status).toBe(204);
    }
  });

  it("keys the per-IP limit on the hop the trusted proxy added, not the client's own entry", async () => {
    const trusted = app({ trustProxy: true });
    for (let i = 0; i < 30; i++) {
      await login(trusted, `nobody${String(i)}`, "x", {
        "x-forwarded-for": `198.51.100.${String(i)}, 203.0.113.30`,
      });
    }
    const res = await login(trusted, "alice", PASSWORD, {
      "x-forwarded-for": "192.0.2.99, 203.0.113.30",
    });
    expect(res.status).toBe(429);
  });

  it("counts failures per client IP only when the proxy is trusted", async () => {
    const trusted = app({ trustProxy: true });
    for (let i = 0; i < 30; i++) {
      await login(trusted, `nobody${String(i)}`, "x", { "x-forwarded-for": "203.0.113.7" });
    }
    expect(
      (await login(trusted, "alice", PASSWORD, { "x-forwarded-for": "203.0.113.7" })).status,
    ).toBe(429);
    expect(
      (await login(trusted, "alice", PASSWORD, { "x-forwarded-for": "203.0.113.8" })).status,
    ).toBe(204);

    const untrusted = app({ trustProxy: false });
    for (let i = 0; i < 30; i++) {
      await login(untrusted, `nobody${String(i)}`, "x", { "x-forwarded-for": "203.0.113.9" });
    }
    // without proxy trust every request comes from the same (unknown) peer, so a fresh IP header
    // changes nothing: the header is ignored
    const spoofed = await login(untrusted, "alice", PASSWORD, {
      "x-forwarded-for": "198.51.100.1",
    });
    expect(spoofed.status).toBe(429);
  });

  it("404s local sign-in when it is turned off", async () => {
    const res = await login(app({ local: { enabled: false, bootstrap: null } }), "alice", PASSWORD);
    expect(res.status).toBe(404);
  });

  it("refuses a disabled account even with the right password", async () => {
    await testDb.db
      .insertInto("users")
      .values({
        username: "dora",
        password_hash: await hashPassword(PASSWORD),
        display_name: "Dora",
        role: "member",
        disabled_at: new Date(),
      })
      .execute();
    expect((await login(app(), "dora", PASSWORD)).status).toBe(403);
  });
});

describe("me, methods and logout", () => {
  it("reports the signed-in user", async () => {
    const a = app();
    const { jar } = cookies(await login(a, "alice", PASSWORD));
    const res = await a.request("/api/me", { headers: { cookie: jar } });
    expect(res.status).toBe(200);
    expect(Me.parse(await res.json())).toMatchObject({
      displayName: "Alice",
      email: "alice@example.org",
      role: "member",
      method: "local",
      isBootstrap: false,
    });
  });

  it("lists the sign-in methods", async () => {
    expect(AuthMethods.parse(await (await app().request("/api/auth/methods")).json())).toEqual({
      local: true,
      oidc: null,
    });
  });

  it("signs out: needs CSRF, deletes the session and clears the cookies", async () => {
    const a = app();
    const c = cookies(await login(a, "alice", PASSWORD));
    const noCsrf = await a.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: c.jar },
    });
    expect(noCsrf.status).toBe(403);
    const res = await a.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: c.jar, "x-uroboros-csrf": c.get("uroboros_csrf") ?? "" },
    });
    expect(res.status).toBe(200);
    expect(LogoutResult.parse(await res.json())).toEqual({ endSessionUrl: null });
    expect(cookies(res).raw.some((h) => h.startsWith("uroboros_session=;"))).toBe(true);
    expect((await a.request("/api/me", { headers: { cookie: c.jar } })).status).toBe(401);
  });
});
