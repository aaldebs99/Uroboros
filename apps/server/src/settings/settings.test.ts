import type { OpenAPIHono } from "@hono/zod-openapi";
import { InstanceSettings } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { digest, newSecret } from "../auth/secrets.ts";
import { readInstanceSettings } from "./store.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let app: OpenAPIHono;
let admin: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  app = createApp({ db: testDb.db, version: "t", logger }, { webDist: null });
  admin = await signedIn(testDb.db, { username: "setadmin", role: "admin" });
});
afterAll(async () => {
  await testDb.close();
});

const patch = (u: SignedIn, body: unknown) =>
  asUser(app, u).request("/api/admin/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("instance settings", () => {
  it("keep the MCP server off until an admin turns it on", async () => {
    const res = await asUser(app, admin).request("/api/admin/settings");
    expect(res.status).toBe(200);
    expect(InstanceSettings.parse(await res.json())).toEqual({ mcpEnabled: false });
    expect(await readInstanceSettings(testDb.db)).toEqual({ mcpEnabled: false });
  });

  it("let an admin turn the MCP server on and off, recording who did", async () => {
    const on = await patch(admin, { mcpEnabled: true });
    expect(on.status).toBe(200);
    expect(InstanceSettings.parse(await on.json())).toEqual({ mcpEnabled: true });
    expect(await readInstanceSettings(testDb.db)).toEqual({ mcpEnabled: true });
    const row = await testDb.db
      .selectFrom("instance_settings")
      .select("updated_by")
      .executeTakeFirstOrThrow();
    expect(row.updated_by).toBe(admin.userId);

    const off = await patch(admin, { mcpEnabled: false });
    expect(InstanceSettings.parse(await off.json())).toEqual({ mcpEnabled: false });
    expect(await readInstanceSettings(testDb.db)).toEqual({ mcpEnabled: false });
  });

  it("are refused to members", async () => {
    const member = await signedIn(testDb.db, { username: "setmember" });
    expect((await asUser(app, member).request("/api/admin/settings")).status).toBe(403);
    expect((await patch(member, { mcpEnabled: true })).status).toBe(403);
    expect(await readInstanceSettings(testDb.db)).toEqual({ mcpEnabled: false });
  });

  it("are refused to an admin's API token", async () => {
    const secret = newSecret();
    await testDb.db
      .insertInto("api_tokens")
      .values({ user_id: admin.userId, name: "settings", token_hash: digest(secret) })
      .execute();
    const res = await app.request("/api/admin/settings", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status).toBe(403);
  });

  it("refuse a patch that changes nothing", async () => {
    expect((await patch(admin, {})).status).toBe(400);
  });
});
