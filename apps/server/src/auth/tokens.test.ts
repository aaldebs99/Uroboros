import type { OpenAPIHono } from "@hono/zod-openapi";
import { NewApiToken, TokenList } from "@uroboros/contract";
import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { MAX_TOKENS_PER_USER } from "./tokens.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let app: OpenAPIHono;

beforeAll(async () => {
  testDb = await TestDb.create();
  app = createApp(
    { db: testDb.db, version: "t", logger, auth: { secureCookies: false } },
    { webDist: null },
  );
});
afterAll(async () => {
  await testDb.close();
});

const create = (u: SignedIn, name: string) =>
  asUser(app, u).request("/api/me/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

describe("API tokens", () => {
  it("shows the secret once on creation and never in the list", async () => {
    const u = await signedIn(testDb.db, { username: "tok1" });
    const res = await create(u, "laptop script");
    expect(res.status).toBe(200);
    const made = NewApiToken.parse(await res.json());
    expect(made.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(made.token.name).toBe("laptop script");
    const listed = await (await asUser(app, u).request("/api/me/tokens")).text();
    expect(listed).not.toContain(made.secret);
    expect(TokenList.parse(JSON.parse(listed)).tokens.map((t) => t.name)).toEqual([
      "laptop script",
    ]);
  });

  it("authenticates as its owner, records its use, and stops when revoked", async () => {
    const u = await signedIn(testDb.db, { username: "tok2" });
    const made = NewApiToken.parse(await (await create(u, "cron")).json());
    const me = await app.request("/api/me", { headers: bearer(made.secret) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: u.userId });
    const row = await testDb.db
      .selectFrom("api_tokens")
      .select("last_used_at")
      .where("id", "=", made.token.id)
      .executeTakeFirstOrThrow();
    expect(row.last_used_at).not.toBeNull();

    const del = await asUser(app, u).request(`/api/me/tokens/${made.token.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);
    expect((await app.request("/api/me", { headers: bearer(made.secret) })).status).toBe(401);
  });

  it("refuses a duplicate name (409) and a token beyond the cap (422)", async () => {
    const u = await signedIn(testDb.db, { username: "tok3" });
    expect((await create(u, "same")).status).toBe(200);
    expect((await create(u, "same")).status).toBe(409);
    for (let i = 1; i < MAX_TOKENS_PER_USER; i++) {
      expect((await create(u, `t${String(i)}`)).status).toBe(200);
    }
    expect(MAX_TOKENS_PER_USER).toBe(20);
    expect((await create(u, "one too many")).status).toBe(422);
  });

  it("holds the cap when creates race at the last free place", async () => {
    const u = await signedIn(testDb.db, { username: "tok7" });
    await testDb.db
      .insertInto("api_tokens")
      .values(
        Array.from({ length: MAX_TOKENS_PER_USER - 1 }, (_, i) => ({
          user_id: u.userId,
          name: `seeded${String(i)}`,
          scopes: ["api"],
          read_only: false,
          token_hash: Buffer.from(`seeded-${u.userId}-${String(i)}`),
        })),
      )
      .execute();
    // Open the pool's connections first, so the creates run side by side rather than one at a
    // time while new connections are made.
    await Promise.all(
      Array.from({ length: 8 }, () => sql`SELECT pg_sleep(0.05)`.execute(testDb.db)),
    );
    const statuses = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => (await create(u, `racer${String(i)}`)).status),
    );
    expect(statuses.sort()).toEqual([200, 422, 422, 422, 422]);
    const { n } = await testDb.db
      .selectFrom("api_tokens")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("user_id", "=", u.userId)
      .executeTakeFirstOrThrow();
    expect(Number(n)).toBe(MAX_TOKENS_PER_USER);
  });

  it("cannot be used to list, create or delete tokens", async () => {
    const u = await signedIn(testDb.db, { username: "tok4" });
    const made = NewApiToken.parse(await (await create(u, "ci")).json());
    const headers = bearer(made.secret);
    expect((await app.request("/api/me/tokens", { headers })).status).toBe(403);
    const made2 = await app.request("/api/me/tokens", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "by bearer" }),
    });
    expect(made2.status).toBe(403);
    const del = await app.request(`/api/me/tokens/${made.token.id}`, {
      method: "DELETE",
      headers,
    });
    expect(del.status).toBe(403);
    // Nothing changed: the only token is the one made with the session, and it still works.
    const listed = TokenList.parse(await (await asUser(app, u).request("/api/me/tokens")).json());
    expect(listed.tokens.map((t) => t.name)).toEqual(["ci"]);
    expect((await app.request("/api/me", { headers })).status).toBe(200);
  });

  it("cannot delete another user's token", async () => {
    const owner = await signedIn(testDb.db, { username: "tok5" });
    const other = await signedIn(testDb.db, { username: "tok6" });
    const made = NewApiToken.parse(await (await create(owner, "mine")).json());
    const res = await asUser(app, other).request(`/api/me/tokens/${made.token.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect((await app.request("/api/me", { headers: bearer(made.secret) })).status).toBe(200);
  });
});
