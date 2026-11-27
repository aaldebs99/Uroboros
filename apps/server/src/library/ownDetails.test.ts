import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryItem } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry, seedProfileless } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { channelKey } from "./channelKey.ts";

/**
 * Giving a video details of one's own (docs/library.md#your-own-details): its title, description
 * and channel, for oneself alone, until reset.
 */

const logger = pino({ level: "silent" });
let t: TestDb;
let alice: SignedIn;
let bob: SignedIn;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  alice = await signedIn(t.db, { username: "odalice" });
  bob = await signedIn(t.db, { username: "odbob" });
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger }, { webDist: null }), s);
const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
const patch = (s: SignedIn, id: string, json: unknown) =>
  send(s, "PATCH", `/api/library/${id}/details`, json);
const reset = (s: SignedIn, id: string) => send(s, "DELETE", `/api/library/${id}/details`);
const item = async (s: SignedIn, id: string) => {
  const res = await send(s, "GET", `/api/library/${id}`);
  expect(res.status).toBe(200);
  return LibraryItem.parse(await res.json());
};
const edits = (s: SignedIn) =>
  t.db.selectFrom("media_edits").selectAll().where("user_id", "=", s.userId).execute();

const SITE = { title: "Site title", description: "The site's words", channel: "Site Channel" };

/** A video of the site's channel `UC-site`, held by each of `who`. */
async function held(who: SignedIn[], title = SITE.title) {
  const videoId = `od-${String(++n)}`;
  const entries = [];
  for (const s of who) {
    entries.push(
      await seedEntry(t.db, s.userId, {
        videoId,
        title,
        media: { channel: SITE.channel, description: SITE.description },
      }),
    );
  }
  await t.db
    .updateTable("media")
    .set({ channel_id: "UC-site" })
    .where("video_id", "=", videoId)
    .execute();
  return { videoId, entries };
}

const MINE = { title: "My title", description: "My words", creator: "My Channel" };

describe("a person's own details of a downloaded video", () => {
  it("are theirs alone: shown to them with the site's beside them, never to another holder", async () => {
    const { entries } = await held([alice, bob]);
    const [a, b] = entries;
    if (a === undefined || b === undefined) throw new Error("seeded");
    const res = await patch(alice, a.entryId, MINE);
    expect(res.status).toBe(200);
    expect(LibraryItem.parse(await res.json())).toMatchObject({
      title: "My title",
      description: "My words",
      channel: "My Channel",
      channelKey: channelKey("youtube", null, "My Channel"),
      editable: false,
      personalEditable: true,
      edited: true,
      original: SITE,
    });
    expect(await item(bob, b.entryId)).toMatchObject({
      ...SITE,
      channelKey: channelKey("youtube", "UC-site", null),
      personalEditable: true,
      edited: false,
      original: null,
    });
  });

  it("keep only what differs from the site's, and nothing once all of it matches again", async () => {
    const { entries } = await held([alice]);
    const id = entries[0]?.entryId ?? "";
    await patch(alice, id, { title: SITE.title, description: "Mine", creator: SITE.channel });
    const mediaId = entries[0]?.mediaId;
    const row = (await edits(alice)).find((r) => r.media_id === mediaId);
    expect(row).toMatchObject({ title: null, description: "Mine", channel: null });
    await patch(alice, id, { description: SITE.description });
    expect((await edits(alice)).find((r) => r.media_id === mediaId)).toBeUndefined();
    expect((await item(alice, id)).edited).toBe(false);
  });

  it("keep a cleared description cleared", async () => {
    const { entries } = await held([alice]);
    const id = entries[0]?.entryId ?? "";
    await patch(alice, id, { description: null });
    const shown = await item(alice, id);
    expect(shown.description).toBeNull();
    expect(shown.original?.description).toBe(SITE.description);
  });

  it("leave alone what isn't sent, even a site's title longer than an upload's", async () => {
    const long = "x".repeat(250);
    const { entries } = await held([alice], long);
    const id = entries[0]?.entryId ?? "";
    const res = await patch(alice, id, { creator: "Elsewhere" });
    expect(res.status).toBe(200);
    expect(LibraryItem.parse(await res.json())).toMatchObject({
      title: long,
      channel: "Elsewhere",
    });
  });

  it("outlast the site's details changing, which show beside them", async () => {
    const { videoId, entries } = await held([alice, bob]);
    const [a, b] = entries;
    await patch(alice, a?.entryId ?? "", { title: "My title" });
    // A probe or fetch rewrites the media row from the site (worker/media.ts).
    await t.db
      .updateTable("media")
      .set({ title: "The site's new title" })
      .where("video_id", "=", videoId)
      .execute();
    const mine = await item(alice, a?.entryId ?? "");
    expect(mine.title).toBe("My title");
    expect(mine.original?.title).toBe("The site's new title");
    expect((await item(bob, b?.entryId ?? "")).title).toBe("The site's new title");
  });

  it("go on Reset, which can be asked again", async () => {
    const { entries } = await held([alice]);
    const id = entries[0]?.entryId ?? "";
    await patch(alice, id, MINE);
    expect((await reset(alice, id)).status).toBe(204);
    expect(await item(alice, id)).toMatchObject({
      ...SITE,
      channelKey: channelKey("youtube", "UC-site", null),
      edited: false,
    });
    expect((await reset(alice, id)).status).toBe(204);
  });

  it("come back with the video when it is removed and added again", async () => {
    const { videoId, entries } = await held([alice]);
    await patch(alice, entries[0]?.entryId ?? "", { title: "Kept" });
    expect((await send(alice, "DELETE", `/api/library/${entries[0]?.entryId ?? ""}`)).status).toBe(
      204,
    );
    const again = await seedEntry(t.db, alice.userId, { videoId });
    expect((await item(alice, again.entryId)).title).toBe("Kept");
  });

  it("can't be given to an entry that isn't the caller's, shared with them or not", async () => {
    const { entries } = await held([alice]);
    const id = entries[0]?.entryId ?? "";
    expect((await patch(bob, id, MINE)).status).toBe(404);
    expect((await reset(bob, id)).status).toBe(404);
    await send(alice, "PUT", `/api/shares/entry/${id}/people`, {
      people: [{ kind: "user", id: bob.userId }],
      expiresAt: null,
    });
    expect((await item(bob, id)).personalEditable).toBe(false);
    expect((await patch(bob, id, MINE)).status).toBe(404);
    expect((await reset(bob, id)).status).toBe(404);
  });
});

describe("a person's own details of someone else's upload", () => {
  it("are theirs alone, under what its uploader changes later", async () => {
    const up = await seedProfileless(t.db, alice.userId, {
      title: "Alice's upload",
      channel: "Alice",
      uploadedBy: alice.userId,
    });
    const mine = await t.db
      .insertInto("library_entries")
      .values({ user_id: bob.userId, media_id: up.mediaId, rendition_id: up.renditionId })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(await item(bob, mine.id)).toMatchObject({ editable: false, personalEditable: true });
    expect((await patch(bob, mine.id, { title: "Bob's name for it" })).status).toBe(200);
    expect((await item(alice, up.entryId)).title).toBe("Alice's upload");
    await patch(alice, up.entryId, { creator: "Grandma" });
    expect(await item(bob, mine.id)).toMatchObject({
      title: "Bob's name for it",
      channel: "Grandma",
    });
  });
});
