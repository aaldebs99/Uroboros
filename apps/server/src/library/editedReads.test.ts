import type { OpenAPIHono } from "@hono/zod-openapi";
import { ChannelSummary, LibraryItem, LibraryPage } from "@uroboros/contract";
import type { Insertable } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import type { MediaEditsTable } from "../db/editsSchema.ts";
import { channelKey } from "./channelKey.ts";

/**
 * A person's own details of a video (docs/library.md#your-own-details), as the library shows them:
 * to that person only, on the item, its listing and sort, and their channels.
 */

const logger = pino({ level: "silent" });
let t: TestDb;
let alice: SignedIn;
let bob: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  alice = await signedIn(t.db, { username: "eralice" });
  bob = await signedIn(t.db, { username: "erbob" });
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
const item = (s: SignedIn, id: string) => get(s, `/api/library/${id}`, LibraryItem);
const page = (s: SignedIn, query: string) => get(s, `/api/library${query}`, LibraryPage);
const channels = (s: SignedIn) => get(s, "/api/library/channels", z.array(ChannelSummary));

/** A video of the site's channel `UC-site` ("Site Channel"), held by each of `who`. */
async function held(videoId: string, who: SignedIn[], title = "Site title") {
  const entries = [];
  for (const s of who) {
    entries.push(
      await seedEntry(t.db, s.userId, {
        videoId,
        title,
        media: { channel: "Site Channel", description: "The site's words" },
      }),
    );
  }
  await t.db
    .updateTable("media")
    .set({ channel_id: "UC-site" })
    .where("video_id", "=", videoId)
    .execute();
  return entries;
}

type Edits = Omit<Insertable<MediaEditsTable>, "user_id" | "media_id">;
const edit = (s: SignedIn, mediaId: string, values: Edits) =>
  t.db
    .insertInto("media_edits")
    .values({ user_id: s.userId, media_id: mediaId, ...values })
    .execute();

const moved = (name: string) => ({ channel: name, channel_extractor: "youtube" });

describe("a person's own details in the library", () => {
  it("shows them to that person, and the site's to another holder of the same video", async () => {
    const [a, b] = await held("er-shared", [alice, bob]);
    if (a === undefined || b === undefined) throw new Error("seeded");
    await edit(alice, a.mediaId, {
      title: "Mine",
      description: "My words",
      ...moved("My Channel"),
    });
    const mine = await item(alice, a.entryId);
    expect(mine).toMatchObject({
      title: "Mine",
      description: "My words",
      channel: "My Channel",
      channelKey: channelKey("youtube", null, "My Channel"),
    });
    expect((await page(alice, "")).entries.find((e) => e.id === a.entryId)?.title).toBe("Mine");
    expect(await item(bob, b.entryId)).toMatchObject({
      title: "Site title",
      description: "The site's words",
      channel: "Site Channel",
      channelKey: channelKey("youtube", "UC-site", "Site Channel"),
    });
  });

  it("shows no description once the person cleared it", async () => {
    const [a] = await held("er-cleared", [alice]);
    if (a === undefined) throw new Error("seeded");
    await edit(alice, a.mediaId, { description: "" });
    expect((await item(alice, a.entryId)).description).toBeNull();
  });

  it("sorts by the person's titles", async () => {
    const carol = await signedIn(t.db, { username: "ercarol" });
    const [zeta] = await held("er-zeta", [carol], "Zeta");
    await held("er-beta", [carol], "Beta");
    if (zeta === undefined) throw new Error("seeded");
    await edit(carol, zeta.mediaId, { title: "Alpha" });
    const titles = (await page(carol, "?sort=title")).entries.map((e) => e.title);
    expect(titles).toEqual(["Alpha", "Beta"]);
  });

  it("groups and lists the person's channels by the ones they moved videos to", async () => {
    const dana = await signedIn(t.db, { username: "erdana" });
    const [stays] = await held("er-stays", [dana]);
    const [named] = await held("er-named", [dana]);
    const [joined] = await held("er-joined", [dana, bob]);
    if (stays === undefined || named === undefined || joined === undefined) throw new Error("x");
    await t.db
      .updateTable("media")
      .set({ channel_id: "UC-other", channel: "Other" })
      .where("video_id", "=", "er-joined")
      .execute();
    // Moved to a channel of its own, and the third into the site channel the first is in.
    await edit(dana, named.mediaId, moved("Favorites"));
    await edit(dana, joined.mediaId, { ...moved("Site Channel"), channel_id: "UC-site" });
    const list = await channels(dana);
    expect(list.map((c) => [c.name, c.count]).sort()).toEqual([
      ["Favorites", 1],
      ["Site Channel", 2],
    ]);
    const ids = async (key: string) =>
      (await page(dana, `?channel=${encodeURIComponent(key)}`)).entries.map((e) => e.id).sort();
    expect(await ids(channelKey("youtube", "UC-site", null) ?? "")).toEqual(
      [stays.entryId, joined.entryId].sort(),
    );
    expect(await ids(channelKey("youtube", null, "Favorites") ?? "")).toEqual([named.entryId]);
    // Bob's copy of the third stays in its site's channel.
    expect((await channels(bob)).map((c) => c.name)).toContain("Other");
  });
});
