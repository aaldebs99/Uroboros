import type { OpenAPIHono } from "@hono/zod-openapi";
import { randomUUID } from "node:crypto";
import { DownloadRequest, Subscription, SubscriptionItemsPage } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { callTool, mcpToken, setMcp } from "../../test/mcp.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { createApp } from "../api/app.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let app: OpenAPIHono;
let owner: string;
let secret: string;
let profileId: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
  app = createApp({ db: testDb.db, version: "t", logger, downloads: h.ctx }, { webDist: null });
  owner = await insertUser(testDb.db, { username: "mcpsubs" });
  secret = await mcpToken(testDb.db, owner);
  profileId = (await seededDefault(testDb.db)).id;
  await setMcp(testDb.db, true);
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

const ok = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await callTool(app, secret, name, args);
  // the tool's error text, when it fails, says why
  expect([name, r.isError === true ? r.content[0]?.text : "ok"]).toEqual([name, "ok"]);
  return r.structuredContent;
};

const base = "https://www.youtube.com/@BlenderOfficial";

/** What the probe worker leaves for a channel link: its tabs to pick from. */
const listTabs = (requestId: string) =>
  testDb.db
    .updateTable("download_requests")
    .set({
      state: "choosing",
      kind: "channel",
      title: "Blender",
      entries: JSON.stringify(
        ["videos", "shorts"].map((tab) => ({
          name: tab === "videos" ? "Videos" : "Shorts",
          url: `${base}/${tab}`,
          ticked: tab === "videos",
          truncated: false,
          entries: [],
        })),
      ),
      source_extractor: "youtube",
      source_id: `UC${randomUUID()}`,
    })
    .where("id", "=", requestId)
    .execute();

async function subscribed(): Promise<Subscription> {
  const preview = DownloadRequest.parse(await ok("preview_subscription", { url: base }));
  expect(preview.state).toBe("probing");
  await listTabs(preview.id);
  return Subscription.parse(
    await ok("create_subscription", {
      requestId: preview.id,
      feeds: ["Videos"],
      profileId,
      schedule: { kind: "interval", minutes: 360 },
    }),
  );
}

describe("the MCP subscription tools", () => {
  it("subscribe to a channel from its preview, then list it", async () => {
    const sub = await subscribed();
    expect(sub).toMatchObject({ kind: "channel", title: "Blender", enabled: true });
    expect(sub.feeds.map((f) => f.name)).toEqual(["Videos"]);
    const listed = Subscription.array().parse((await ok("list_subscriptions"))?.subscriptions);
    expect(listed.map((s) => s.id)).toContain(sub.id);
    const items = SubscriptionItemsPage.parse(
      await ok("list_subscription_items", { subscriptionId: sub.id }),
    );
    expect(items.items).toEqual([]);
  });

  it("pause a subscription, refuse to check it while paused, and check it once resumed", async () => {
    const sub = await subscribed();
    const paused = Subscription.parse(
      await ok("update_subscription", { subscriptionId: sub.id, changes: { enabled: false } }),
    );
    expect(paused.enabled).toBe(false);
    const refused = await callTool(app, secret, "check_subscription_now", {
      subscriptionId: sub.id,
    });
    expect(refused.content[0]?.text).toBe("conflict: this subscription is paused");
    await ok("update_subscription", { subscriptionId: sub.id, changes: { enabled: true } });
    await ok("check_subscription_now", { subscriptionId: sub.id });
    expect(await h.queues.automation.get(`check|${sub.id}`)).toBeDefined();
  });

  it("unsubscribe", async () => {
    const sub = await subscribed();
    expect(await ok("delete_subscription", { subscriptionId: sub.id })).toEqual({
      deleted: sub.id,
    });
    const listed = Subscription.array().parse((await ok("list_subscriptions"))?.subscriptions);
    expect(listed.map((s) => s.id)).not.toContain(sub.id);
  });

  it("never reach someone else's subscription", async () => {
    const sub = await subscribed();
    const stranger = await insertUser(testDb.db, { username: "mcpsubs2" });
    const theirs = await mcpToken(testDb.db, stranger);
    const r = await callTool(app, theirs, "delete_subscription", { subscriptionId: sub.id });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/^not_found: /);
  });
});
