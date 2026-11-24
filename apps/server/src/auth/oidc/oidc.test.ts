import type { OpenAPIHono } from "@hono/zod-openapi";
import { AuthMethods, LogoutResult, Me } from "@uroboros/contract";
import type { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  startIdp,
  type Person,
  type TestIdp,
} from "../../../test/oidcIdp.ts";
import { TestDb } from "../../../test/testDb.ts";
import { TestValkey } from "../../../test/testValkey.ts";
import { createApp } from "../../api/app.ts";
import { createValkey, waitReady } from "../../shared/valkey.ts";
import type { AuthConfig, OidcConfig } from "../config.ts";
import { createOidcProvider, type OidcProvider } from "./provider.ts";

const logger = pino({ level: "silent" });
const BASE = "https://uro.example";

let testDb: TestDb;
let valkey: Redis;
let idp: TestIdp;
let provider: OidcProvider;
let app: OpenAPIHono;
const stop = new AbortController();

const oidcConfig = (): OidcConfig => ({
  issuer: idp.issuer,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  displayName: "Authentik",
  adminGroups: ["authentik Admins"],
  groupsClaim: "groups",
  syncIntervalSecs: 900,
  redirectUrl: `${BASE}/api/auth/oidc/callback`,
});

function makeApp(p: OidcProvider): OpenAPIHono {
  const settings: AuthConfig = {
    sessionTtlHours: 1,
    trustProxy: false,
    local: { enabled: true, bootstrap: null },
    oidc: oidcConfig(),
  };
  return createApp(
    {
      db: testDb.db,
      valkey,
      version: "t",
      logger,
      auth: { secureCookies: true, settings, oidc: p },
    },
    { webDist: null },
  );
}

beforeAll(async () => {
  testDb = await TestDb.create();
  valkey = createValkey(TestValkey.url(), "api", logger);
  await waitReady(valkey, 5000);
  idp = await startIdp();
  provider = createOidcProvider(oidcConfig(), { logger, fetch: idp.fetch });
  provider.start(stop.signal);
  await vi.waitFor(
    () => {
      expect(provider.ready()).toBe(true);
    },
    { timeout: 10_000 },
  );
  app = makeApp(provider);
});
afterAll(async () => {
  stop.abort();
  valkey.disconnect();
  await idp.close();
  await testDb.close();
});
afterEach(() => {
  idp.forge("none");
});

function setCookies(res: Response): Map<string, string> {
  return new Map(
    res.headers.getSetCookie().map((h) => {
      const [pair = ""] = h.split(";");
      const i = pair.indexOf("=");
      return [pair.slice(0, i), pair.slice(i + 1)];
    }),
  );
}

/** Starts a sign-in: the provider URL and the browser-binding cookie. */
async function begin(
  a = app,
  returnTo?: string,
): Promise<{ location: string; binding: string; state: string }> {
  const q = returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const res = await a.request(`/api/auth/oidc/login${q}`);
  expect(res.status).toBe(303);
  const location = res.headers.get("location") ?? "";
  return {
    location,
    binding: setCookies(res).get("uroboros_oidc") ?? "",
    state: new URL(location).searchParams.get("state") ?? "",
  };
}

async function callback(query: string, binding: string, a = app): Promise<Response> {
  return a.request(`/api/auth/oidc/callback?${query}`, {
    headers: binding === "" ? {} : { cookie: `uroboros_oidc=${binding}` },
  });
}

/** A full sign-in as `person`; returns the callback response. */
async function signIn(person: Person, returnTo?: string): Promise<Response> {
  const b = await begin(app, returnTo);
  const code = idp.authorize(b.location, person);
  return callback(`code=${code}&state=${b.state}`, b.binding);
}

const errorOf = (res: Response) =>
  new URL(res.headers.get("location") ?? "", BASE).searchParams.get("auth_error");

describe("OIDC sign-in", () => {
  it("sends the browser to the provider with PKCE S256, state and nonce", async () => {
    const { location } = await begin();
    const url = new URL(location);
    expect(url.origin).toBe(idp.issuer);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/oidc/callback`);
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("nonce")).toBeTruthy();
  });

  it("signs in an admin by group and returns to the saved path", async () => {
    const res = await signIn(
      { sub: "u-admin", name: "Ada", email: "ada@example.org", groups: ["authentik Admins"] },
      "/settings",
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/settings");
    const jar = [...setCookies(res)].map(([k, v]) => `${k}=${v}`).join("; ");
    const me = Me.parse(await (await app.request("/api/me", { headers: { cookie: jar } })).json());
    expect(me).toMatchObject({
      displayName: "Ada",
      email: "ada@example.org",
      role: "admin",
      method: "oidc",
    });
    const grant = await testDb.db.selectFrom("oidc_grants").selectAll().execute();
    expect(grant.length).toBeGreaterThan(0);
  });

  it("signs in a member without the admin group, and updates the same account next time", async () => {
    await signIn({ sub: "u-mem", name: "Mo", groups: [] });
    await signIn({ sub: "u-mem", name: "Mo B", groups: ["authentik Admins"] });
    const rows = await testDb.db
      .selectFrom("users")
      .select(["display_name", "role"])
      .where("oidc_subject", "=", "u-mem")
      .execute();
    expect(rows).toEqual([{ display_name: "Mo B", role: "admin" }]);
  });

  it("forgets the stored grant when a sign-in brings no refresh token", async () => {
    await signIn({ sub: "u-norefresh" });
    const grants = () =>
      testDb.db
        .selectFrom("oidc_grants as g")
        .innerJoin("users as u", "u.id", "g.user_id")
        .select("g.refresh_token")
        .where("u.oidc_subject", "=", "u-norefresh")
        .execute();
    expect(await grants()).toHaveLength(1);
    idp.issueRefreshOnSignIn(false);
    try {
      expect((await signIn({ sub: "u-norefresh" })).status).toBe(303);
    } finally {
      idp.issueRefreshOnSignIn(true);
    }
    expect(await grants()).toEqual([]);
  });

  it("refuses a replayed state", async () => {
    const b = await begin();
    const code = idp.authorize(b.location, { sub: "u-replay" });
    expect(
      (await callback(`code=${code}&state=${b.state}`, b.binding)).headers.get("location"),
    ).toBe("/");
    const again = await callback(`code=${code}&state=${b.state}`, b.binding);
    expect(errorOf(again)).toBe("expired");
  });

  it("refuses a callback without the browser binding, or with another browser's", async () => {
    const b = await begin();
    const code = idp.authorize(b.location, { sub: "u-bind" });
    expect(errorOf(await callback(`code=${code}&state=${b.state}`, ""))).toBe("failed");
    const other = await begin();
    const b2 = await begin();
    const code2 = idp.authorize(b2.location, { sub: "u-bind" });
    expect(errorOf(await callback(`code=${code2}&state=${b2.state}`, other.binding))).toBe(
      "failed",
    );
  });

  it("refuses a pending sign-in older than 10 minutes", async () => {
    const b = await begin();
    await testDb.db
      .updateTable("auth_logins")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .execute();
    const code = idp.authorize(b.location, { sub: "u-late" });
    expect(errorOf(await callback(`code=${code}&state=${b.state}`, b.binding))).toBe("expired");
  });

  it("reports a cancelled sign-in", async () => {
    const b = await begin();
    expect(errorOf(await callback(`error=access_denied&state=${b.state}`, b.binding))).toBe(
      "cancelled",
    );
  });

  it.each(["nonce", "signature", "hs256", "issuer"] as const)(
    "refuses an ID token with a bad %s",
    async (kind) => {
      idp.forge(kind);
      const res = await signIn({ sub: `u-${kind}` });
      expect(errorOf(res)).toBe("failed");
      const made = await testDb.db
        .selectFrom("users")
        .select("id")
        .where("oidc_subject", "=", `u-${kind}`)
        .execute();
      expect(made).toEqual([]);
    },
  );

  it("refuses a disabled user without stamping a sign-in", async () => {
    await signIn({ sub: "u-off" });
    await testDb.db
      .updateTable("users")
      .set({ disabled_at: new Date(), last_login_at: null })
      .where("oidc_subject", "=", "u-off")
      .execute();
    expect(errorOf(await signIn({ sub: "u-off" }))).toBe("disabled");
    const row = await testDb.db
      .selectFrom("users")
      .select("last_login_at")
      .where("oidc_subject", "=", "u-off")
      .executeTakeFirstOrThrow();
    expect(row.last_login_at).toBeNull();
  });

  it.each([
    "//evil.example/x",
    "https://evil.example/",
    "/\\evil.example",
    "settings",
    "/\t/evil.example/x",
    "/\n/evil.example",
    "/ /evil.example",
  ])("returns to / instead of the unsafe path %s", async (returnTo) => {
    const res = await signIn({ sub: "u-ret" }, returnTo);
    expect(res.headers.get("location")).toBe("/");
  });

  it("lists OIDC as ready and gives SSO users the provider's end-session URL on sign-out", async () => {
    expect(AuthMethods.parse(await (await app.request("/api/auth/methods")).json()).oidc).toEqual({
      displayName: "Authentik",
      ready: true,
    });
    const res = await signIn({ sub: "u-out" });
    const cookies = setCookies(res);
    const jar = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const out = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: jar, "x-uroboros-csrf": cookies.get("uroboros_csrf") ?? "" },
    });
    const url = new URL(LogoutResult.parse(await out.json()).endSessionUrl ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(`${idp.issuer}/end-session`);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(`${BASE}/`);
  });
});

describe("before discovery", () => {
  it("reports OIDC not ready and answers sign-in with unavailable", async () => {
    idp.discoverable(false);
    const cold = createOidcProvider(oidcConfig(), { logger, fetch: idp.fetch });
    const s = new AbortController();
    cold.start(s.signal);
    try {
      const a = makeApp(cold);
      expect(
        AuthMethods.parse(await (await a.request("/api/auth/methods")).json()).oidc?.ready,
      ).toBe(false);
      const res = await a.request("/api/auth/oidc/login");
      expect(errorOf(res)).toBe("unavailable");
    } finally {
      s.abort();
      idp.discoverable(true);
    }
  });
});
