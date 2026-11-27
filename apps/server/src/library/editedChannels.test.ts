import type { OpenAPIHono } from "@hono/zod-openapi";
import { ChannelSummary, LibraryItem, LibraryPage } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry, seedProfileless } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { channelKey } from "./channelKey.ts";

/**
 * Moving a video to another channel by naming it (docs/library.md#your-own-details): into one of
 * the person's channels of that name, or a new one of its own; never into anyone else's library.
 */

const logger = pino({ level: "silent" });
let t: TestDb;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger }, { webDist: null }), s);
const get = async <T>(s: SignedIn, path: string, schema: z.ZodType<T>): Promise<T> => {
  const res = await app(s).request(path);
  expect(res.status).toBe(200);
  return schema.parse(await res.json());
};
const name = async (s: SignedIn, id: string, creator: string) => {
  const res = await app(s).request(`/api/library/${id}/details`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creator }),
  });
  expect(res.status).toBe(200);
  return LibraryItem.parse(await res.json());
};
const channels = (s: SignedIn) => get(s, "/api/library/channels", z.array(ChannelSummary));
const inChannel = async (s: SignedIn, key: string | null) =>
  (await get(s, `/api/library?channel=${encodeURIComponent(key ?? "")}`, LibraryPage)).entries
    .map((e) => e.id)
    .sort();

async function person() {
  return signedIn(t.db, { username: `ech${String(++n)}` });
}

/** A YouTube video of `who`'s in the channel `channel` (id `channelId`, or keyed by name). */
async function video(who: SignedIn, channel: string | null, channelId: string | null = null) {
  const videoId = `ech-v${String(++n)}`;
  const e = await seedEntry(t.db, who.userId, { videoId, media: { channel } });
  await t.db
    .updateTable("media")
    .set({ channel_id: channelId })
    .where("video_id", "=", videoId)
    .execute();
  return e.entryId;
}

describe("moving a video to another channel", () => {
  it("starts a channel of its own for a new name, out of the site's", async () => {
    const me = await person();
    const stays = await video(me, "Site Channel", "UC-site");
    const moves = await video(me, "Site Channel", "UC-site");
    const moved = await name(me, moves, "Favorites");
    expect(moved.channelKey).toBe(channelKey("youtube", null, "Favorites"));
    expect((await channels(me)).map((c) => [c.name, c.count]).sort()).toEqual([
      ["Favorites", 1],
      ["Site Channel", 1],
    ]);
    expect(await inChannel(me, moved.channelKey)).toEqual([moves]);
    expect(await inChannel(me, channelKey("youtube", "UC-site", null))).toEqual([stays]);
  });

  it("joins the person's channel of that name in any case, under its own name and key", async () => {
    const me = await person();
    const there = await video(me, "Site Channel", "UC-site");
    const moves = await video(me, "Other", "UC-other");
    const moved = await name(me, moves, "site channel");
    expect(moved).toMatchObject({
      channel: "Site Channel",
      channelKey: channelKey("youtube", "UC-site", null),
    });
    expect(await inChannel(me, moved.channelKey)).toEqual([there, moves].sort());
  });

  it("joins a channel of another site's by its name", async () => {
    const me = await person();
    const upload = await seedProfileless(t.db, me.userId, {
      channel: "Grandpa",
      uploadedBy: me.userId,
    });
    const moves = await video(me, "Some channel", "UC-some");
    const moved = await name(me, moves, "grandpa");
    expect(moved).toMatchObject({
      channel: "Grandpa",
      channelKey: channelKey("upload", null, "Grandpa"),
    });
    expect(await inChannel(me, moved.channelKey)).toEqual([upload.entryId, moves].sort());
  });

  it("takes naming the site's own channel, or the site's name a video without one shows, as no move", async () => {
    const me = await person();
    const id = await video(me, "Site Channel", "UC-site");
    expect(await name(me, id, "SITE CHANNEL")).toMatchObject({
      channelKey: channelKey("youtube", "UC-site", null),
      edited: false,
    });
    const none = await video(me, null);
    expect(await name(me, none, "YouTube")).toMatchObject({ channelKey: null, edited: false });
  });

  it("moves nothing in another person's library", async () => {
    const me = await person();
    const other = await person();
    const videoId = `ech-shared${String(++n)}`;
    const mine = await seedEntry(t.db, me.userId, { videoId, media: { channel: "Site" } });
    await seedEntry(t.db, other.userId, { videoId, media: { channel: "Site" } });
    await name(me, mine.entryId, "Mine now");
    expect((await channels(other)).map((c) => c.name)).toEqual(["Site"]);
  });
});
