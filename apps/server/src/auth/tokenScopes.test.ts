import type { OpenAPIHono } from "@hono/zod-openapi";
import { NewApiToken, TokenList } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { writeInstanceSettings } from "../settings/store.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let app: OpenAPIHono;
let n = 0;

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

async function person(): Promise<SignedIn> {
  n++;
  return signedIn(testDb.db, { username: `scope${String(n)}` });
}

async function setMcp(on: boolean): Promise<void> {
  const admin = await signedIn(testDb.db, { username: `scopeadmin${String(++n)}`, role: "admin" });
  await writeInstanceSettings(testDb.db, { mcpEnabled: on }, admin.userId);
}

const create = (u: SignedIn, body: Record<string, unknown>) =>
  asUser(app, u).request("/api/me/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function made(u: SignedIn, body: Record<string, unknown>): Promise<NewApiToken> {
  const res = await create(u, body);
  expect(res.status).toBe(200);
  return NewApiToken.parse(await res.json());
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

describe("API token scopes", () => {
  it("default a new token to the REST API, read and write", async () => {
    const u = await person();
    const t = await made(u, { name: "plain" });
    expect(t.token.scopes).toEqual(["api"]);
    expect(t.token.readOnly).toBe(false);
  });

  it("drop repeated scopes and refuse a token with none", async () => {
    const u = await person();
    expect((await made(u, { name: "twice", scopes: ["api", "api"] })).token.scopes).toEqual([
      "api",
    ]);
    expect((await create(u, { name: "none", scopes: [] })).status).toBe(400);
  });

  it("refuse an MCP token while the MCP server is off, and allow it once it is on", async () => {
    const u = await person();
    await setMcp(false);
    const refused = await create(u, { name: "agent", scopes: ["mcp"] });
    expect(refused.status).toBe(409);
    await setMcp(true);
    const t = await made(u, { name: "agent", scopes: ["mcp", "api"] });
    expect(t.token.scopes).toEqual(["api", "mcp"]);
    await setMcp(false);
  });

  it("list the tokens with whether the MCP server is on", async () => {
    const u = await person();
    await made(u, { name: "reader", readOnly: true });
    await setMcp(true);
    const on = TokenList.parse(await (await asUser(app, u).request("/api/me/tokens")).json());
    expect(on.mcp).toEqual({ enabled: true });
    expect(on.tokens.map((t) => [t.name, t.scopes, t.readOnly])).toEqual([
      ["reader", ["api"], true],
    ]);
    await setMcp(false);
    const off = TokenList.parse(await (await asUser(app, u).request("/api/me/tokens")).json());
    expect(off.mcp).toEqual({ enabled: false });
  });

  it("keep an MCP-only token off the REST API", async () => {
    const u = await person();
    await setMcp(true);
    const t = await made(u, { name: "mcp only", scopes: ["mcp"] });
    await setMcp(false);
    const res = await app.request("/api/me", { headers: bearer(t.secret) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ message: "this token cannot use the REST API" });
  });

  it("keep a REST token off the MCP endpoint", async () => {
    const u = await person();
    const t = await made(u, { name: "rest only" });
    const res = await app.request("/api/mcp", { method: "POST", headers: bearer(t.secret) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ message: "this token cannot use MCP" });
  });

  it("let a read-only token read but never write", async () => {
    const u = await person();
    const t = await made(u, { name: "look only", readOnly: true });
    expect((await app.request("/api/me", { headers: bearer(t.secret) })).status).toBe(200);
    expect(
      (await app.request("/api/me", { method: "HEAD", headers: bearer(t.secret) })).status,
    ).toBe(200);
    const post = await app.request("/api/playlists", {
      method: "POST",
      headers: { ...bearer(t.secret), "content-type": "application/json" },
      body: JSON.stringify({ name: "nope" }),
    });
    expect(post.status).toBe(403);
    expect(await post.json()).toMatchObject({ message: "this token is read-only" });
    const del = await app.request(`/api/playlists/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: bearer(t.secret),
    });
    expect(del.status).toBe(403);
  });

  it("never take a browser session on the MCP endpoint, and ask for a bearer token", async () => {
    const u = await person();
    const res = await asUser(app, u).request("/api/mcp", { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });
});
