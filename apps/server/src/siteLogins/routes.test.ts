import type { OpenAPIHono } from "@hono/zod-openapi";
import { SiteLogins, SiteLoginView } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { mcpToken } from "../../test/mcp.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { loginsForFetch, loginsOf } from "./forJobs.ts";

const logger = pino({ level: "silent" });
const KEY = Buffer.alloc(32, 9);
const OTHER_KEY = Buffer.alloc(32, 8);

let testDb: TestDb;
let app: OpenAPIHono;
let keyless: OpenAPIHono;

const appWith = (secretsKey: Buffer | null) =>
  createApp(
    {
      db: testDb.db,
      version: "t",
      logger,
      auth: { secureCookies: false },
      secretsKey,
    },
    { webDist: null },
  );

beforeAll(async () => {
  testDb = await TestDb.create();
  app = appWith(KEY);
  keyless = appWith(null);
});
afterAll(async () => {
  await testDb.close();
});

const put = (on: OpenAPIHono, u: SignedIn, site: string, body: unknown) =>
  asUser(on, u).request(`/api/me/site-logins/${site}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const list = async (on: OpenAPIHono, u: SignedIn) => {
  const res = await asUser(on, u).request("/api/me/site-logins");
  expect(res.status).toBe(200);
  return SiteLogins.parse(await res.json());
};

describe("site logins", () => {
  it("saves, replaces and lists a login without ever returning or storing the password", async () => {
    const u = await signedIn(testDb.db, { username: "sl1" });
    const saved = await put(app, u, "vimeo", { username: "me@example.com", password: "hunter22" });
    expect(saved.status).toBe(200);
    expect(SiteLoginView.parse(await saved.json())).toMatchObject({
      site: "vimeo",
      username: "me@example.com",
      state: "ok",
    });
    await put(app, u, "vimeo", { username: "me2@example.com", password: "better-one" });
    const body = await list(app, u);
    expect(body.enabled).toBe(true);
    expect(body.logins).toEqual([
      expect.objectContaining({ site: "vimeo", username: "me2@example.com", state: "ok" }),
    ]);
    expect(JSON.stringify(body)).not.toContain("better-one");
    const row = await testDb.db
      .selectFrom("site_logins")
      .select("password_sealed")
      .where("user_id", "=", u.userId)
      .executeTakeFirstOrThrow();
    expect(row.password_sealed.includes(Buffer.from("better-one"))).toBe(false);
    expect(await loginsOf(testDb.db, KEY, u.userId)).toEqual([
      { site: "vimeo", username: "me2@example.com", password: "better-one" },
    ]);
  });

  it("refuses a site yt-dlp does not sign in to, and a control character", async () => {
    const u = await signedIn(testDb.db, { username: "sl2" });
    expect((await put(app, u, "youtube", { username: "a", password: "b" })).status).toBe(400);
    expect((await put(app, u, "vimeo", { username: "a", password: "b\nc" })).status).toBe(400);
  });

  it("removes a login, and answers 404 for one that is not there", async () => {
    const u = await signedIn(testDb.db, { username: "sl3" });
    await put(app, u, "twitch", { username: "a", password: "bbbb" });
    const del = () => asUser(app, u).request("/api/me/site-logins/twitch", { method: "DELETE" });
    expect((await del()).status).toBe(204);
    expect((await del()).status).toBe(404);
    expect((await list(app, u)).logins).toEqual([]);
  });

  it("keeps each person's logins to themselves", async () => {
    const a = await signedIn(testDb.db, { username: "sl4a" });
    const b = await signedIn(testDb.db, { username: "sl4b" });
    await put(app, a, "soundcloud", { username: "a", password: "secret-a" });
    expect((await list(app, b)).logins).toEqual([]);
    const del = await asUser(app, b).request("/api/me/site-logins/soundcloud", {
      method: "DELETE",
    });
    expect(del.status).toBe(404);
    expect(await loginsOf(testDb.db, KEY, b.userId)).toEqual([]);
  });

  it("is off without a key: nothing saves, and saved logins read as unreadable", async () => {
    const u = await signedIn(testDb.db, { username: "sl5" });
    await put(app, u, "vimeo", { username: "a", password: "bbbb" });
    const refused = await put(keyless, u, "vimeo", { username: "a", password: "cccc" });
    expect(refused.status).toBe(409);
    const body = await list(keyless, u);
    expect(body.enabled).toBe(false);
    expect(body.logins).toEqual([expect.objectContaining({ site: "vimeo", state: "unreadable" })]);
    expect(await loginsOf(testDb.db, null, u.userId)).toEqual([]);
  });

  it("reads a login sealed under another key as unreadable, and the jobs skip it", async () => {
    const u = await signedIn(testDb.db, { username: "sl6" });
    await put(app, u, "vimeo", { username: "a", password: "bbbb" });
    const rotated = appWith(OTHER_KEY);
    expect((await list(rotated, u)).logins).toEqual([
      expect.objectContaining({ state: "unreadable" }),
    ]);
    expect(await loginsOf(testDb.db, OTHER_KEY, u.userId)).toEqual([]);
  });

  it("refuses the person's own API token, reading or saving", async () => {
    const u = await signedIn(testDb.db, { username: "sl7" });
    const headers = {
      authorization: `Bearer ${await mcpToken(testDb.db, u.userId, { scopes: ["api"] })}`,
    };
    // The token itself works elsewhere: the refusal is this path's.
    expect((await app.request("/api/me", { headers })).status).toBe(200);
    expect((await app.request("/api/me/site-logins", { headers })).status).toBe(403);
    const saved = await app.request("/api/me/site-logins/vimeo", {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ username: "a", password: "bbbb" }),
    });
    expect(saved.status).toBe(403);
    expect((await list(app, u)).logins).toEqual([]);
  });
});

describe("loginsForFetch", () => {
  it("takes, per site, the login of the earliest person waiting on the fetch", async () => {
    const first = await signedIn(testDb.db, { username: "sl8a" });
    const second = await signedIn(testDb.db, { username: "sl8b" });
    const idle = await signedIn(testDb.db, { username: "sl8c" });
    await put(app, first, "vimeo", { username: "first", password: "first-pw" });
    await put(app, second, "vimeo", { username: "second", password: "second-pw" });
    await put(app, second, "twitch", { username: "second", password: "second-tw" });
    await put(app, idle, "tumblr", { username: "idle", password: "idle-pw" });
    const profile = await testDb.db
      .selectFrom("format_profiles")
      .select(["id", "revision"])
      .executeTakeFirstOrThrow();
    const key = "fetch|vimeo|1|p|r";
    for (const [user, at] of [
      [first, "2026-11-23T10:00:00Z"],
      [second, "2026-11-23T10:05:00Z"],
    ] as const) {
      await testDb.db
        .insertInto("downloads")
        .values({
          user_id: user.userId,
          url: "https://vimeo.com/1",
          extractor: "vimeo",
          video_id: "1",
          profile_id: profile.id,
          profile_revision: profile.revision,
          fetch_key: key,
          args: JSON.stringify({}),
          state: "queued",
          created_at: at,
        })
        .execute();
    }
    const logins = await loginsForFetch(testDb.db, KEY, key);
    expect(logins.sort((a, b) => a.site.localeCompare(b.site))).toEqual([
      { site: "twitch", username: "second", password: "second-tw" },
      { site: "vimeo", username: "first", password: "first-pw" },
    ]);
    expect(await loginsForFetch(testDb.db, null, key)).toEqual([]);
  });
});
