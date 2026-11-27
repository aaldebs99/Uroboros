import type { OpenAPIHono } from "@hono/zod-openapi";
import { ChannelSummary, LibraryPage } from "@uroboros/contract";
import { pino } from "pino";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { channelKey } from "./channelKey.ts";

/** `PUT /api/library/channels/{key}/hidden` and `GET /api/library?hidden` (docs/library.md). */

const logger = pino({ level: "silent" });
let testDb: TestDb;
let alice: SignedIn;
let bob: SignedIn;

const ALPHA = channelKey("youtube", "UC-alpha", "Alpha") ?? "";
const BETA = channelKey("youtube", "UC-beta", "Beta") ?? "";
const NAMED = channelKey("youtube", null, "Named") ?? "";
const CREATOR = channelKey("upload", null, "Creator") ?? "";

/** An entry of `who`'s, its media in the given channel (`channelId` null keys it by name). */
async function entry(
  who: SignedIn,
  videoId: string,
  title: string,
  channel: { extractor?: string; channelId: string | null; name: string | null },
): Promise<string> {
  const { entryId } = await seedEntry(testDb.db, who.userId, { videoId, title });
  await testDb.db
    .updateTable("media")
    .set({
      extractor: channel.extractor ?? "youtube",
      channel_id: channel.channelId,
      channel: channel.name,
    })
    .where("video_id", "=", videoId)
    .execute();
  return entryId;
}

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await signedIn(testDb.db, { username: "hcalice" });
  bob = await signedIn(testDb.db, { username: "hcbob" });
  await entry(alice, "hc-a1", "Alpha one", { channelId: "UC-alpha", name: "Alpha" });
  await entry(alice, "hc-a2", "Alpha two", { channelId: "UC-alpha", name: "Alpha" });
  await entry(alice, "hc-b1", "Beta one", { channelId: "UC-beta", name: "Beta" });
  await entry(alice, "hc-n1", "Named one", { channelId: null, name: "Named" });
  await entry(alice, "hc-u1", "Uploaded one", {
    extractor: "upload",
    channelId: null,
    name: "Creator",
  });
  await entry(alice, "hc-x1", "No channel", { channelId: null, name: null });
  const listed = await entry(alice, "hc-p1", "In a hiding playlist", {
    channelId: "UC-beta",
    name: "Beta",
  });
  const p = await testDb.db
    .insertInto("playlists")
    .values({ user_id: alice.userId, name: "Hidden", hide_from_library: true })
    .returning("id")
    .executeTakeFirstOrThrow();
  await testDb.db
    .insertInto("playlist_items")
    .values({ playlist_id: p.id, user_id: alice.userId, entry_id: listed, position: 0 })
    .execute();
  await entry(bob, "hc-bob", "Bob's alpha", { channelId: "UC-alpha", name: "Alpha" });
});
afterEach(async () => {
  await testDb.db.deleteFrom("hidden_channels").execute();
});
afterAll(async () => {
  await testDb.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: testDb.db, version: "t", logger }, { webDist: null }), s);

const hide = (s: SignedIn, key: string, hidden: unknown) =>
  app(s).request(`/api/library/channels/${key}/hidden`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hidden }),
  });

async function titles(s: SignedIn, query: string): Promise<string[]> {
  const res = await app(s).request(`/api/library${query}`);
  expect(res.status).toBe(200);
  return LibraryPage.parse(await res.json())
    .entries.map((e) => e.title)
    .sort();
}

async function channels(s: SignedIn): Promise<Record<string, boolean>> {
  const res = await app(s).request("/api/library/channels");
  expect(res.status).toBe(200);
  const list = z.array(ChannelSummary).parse(await res.json());
  return Object.fromEntries(list.map((c) => [c.name, c.hideFromLibrary]));
}

describe("hiding a channel from the library", () => {
  it("starts every channel showing", async () => {
    expect(await channels(alice)).toEqual({
      Alpha: false,
      Beta: false,
      Named: false,
      Creator: false,
    });
  });

  it("hides a channel keyed by id: its videos leave hidden=false, and the list says so", async () => {
    expect((await hide(alice, ALPHA, true)).status).toBe(204);
    expect((await channels(alice)).Alpha).toBe(true);
    expect(await titles(alice, "?hidden=false")).toEqual([
      "Beta one",
      "Named one",
      "No channel",
      "Uploaded one",
    ]);
  });

  it("hides a channel keyed by name, and an uploader's channel", async () => {
    expect((await hide(alice, NAMED, true)).status).toBe(204);
    expect((await hide(alice, CREATOR, true)).status).toBe(204);
    expect(await titles(alice, "?hidden=false")).toEqual([
      "Alpha one",
      "Alpha two",
      "Beta one",
      "No channel",
    ]);
  });

  it("keeps what a channel or a playlist hides with hidden=true", async () => {
    await hide(alice, ALPHA, true);
    expect(await titles(alice, "?hidden=true")).toEqual([
      "Alpha one",
      "Alpha two",
      "In a hiding playlist",
    ]);
  });

  it("still shows a hidden channel's videos on its page, in a search and without hidden", async () => {
    await hide(alice, ALPHA, true);
    expect(await titles(alice, `?channel=${ALPHA}`)).toEqual(["Alpha one", "Alpha two"]);
    expect(await titles(alice, "?q=alpha")).toEqual(["Alpha one", "Alpha two"]);
    expect(await titles(alice, "")).toHaveLength(7);
  });

  it("hides for the caller alone", async () => {
    await hide(alice, ALPHA, true);
    expect(await titles(bob, "?hidden=false")).toEqual(["Bob's alpha"]);
    expect((await channels(bob)).Alpha).toBe(false);
  });

  it("shows a channel again, and showing one that is not hidden is fine", async () => {
    await hide(alice, BETA, true);
    expect((await hide(alice, BETA, false)).status).toBe(204);
    expect((await hide(alice, BETA, false)).status).toBe(204);
    expect((await channels(alice)).Beta).toBe(false);
    expect(await titles(alice, "?hidden=false")).toContain("Beta one");
  });

  it("refuses a key that is not one (400), and hides only a channel in the library (404)", async () => {
    expect((await hide(alice, "not-a-key", true)).status).toBe(400);
    expect((await hide(alice, ALPHA, "yes")).status).toBe(400);
    const elsewhere = channelKey("youtube", "UC-nowhere", "Nowhere") ?? "";
    expect((await hide(alice, elsewhere, true)).status).toBe(404);
    expect((await hide(alice, elsewhere, false)).status).toBe(204);
  });
});
