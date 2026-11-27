import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryPage } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { seedYouTubePlaylist } from "../../test/playlists.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";

/** `GET /api/library?hidden` (docs/library.md "Hiding from the library"). */

const logger = pino({ level: "silent" });
let testDb: TestDb;
let alice: SignedIn;

/** Alice's playlist named `name`, holding `entryIds`, hiding its videos or not. */
async function playlist(name: string, entryIds: string[], hide: boolean): Promise<void> {
  const p = await testDb.db
    .insertInto("playlists")
    .values({ user_id: alice.userId, name, hide_from_library: hide })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const [position, entry_id] of entryIds.entries()) {
    await testDb.db
      .insertInto("playlist_items")
      .values({ playlist_id: p.id, user_id: alice.userId, entry_id, position })
      .execute();
  }
}

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await signedIn(testDb.db, { username: "hdalice" });
  const bob = await signedIn(testDb.db, { username: "hdbob" });
  const entry = async (videoId: string, title: string) =>
    (await seedEntry(testDb.db, alice.userId, { videoId, title })).entryId;
  const inHiding = await entry("hd-1", "In a hiding playlist");
  await entry("hd-2", "In a hiding YouTube playlist");
  const inShowing = await entry("hd-3", "In a showing playlist");
  await entry("hd-4", "In no playlist");
  const inBoth = await entry("hd-5", "In a hiding and a showing playlist");
  await entry("hd-6", "In Bob's hiding YouTube playlist");
  await playlist("Hidden", [inHiding, inBoth], true);
  await playlist("Shown", [inShowing, inBoth], false);
  const yt = await seedYouTubePlaylist(testDb.db, [alice.userId], ["hd-2"]);
  const bobs = await seedYouTubePlaylist(testDb.db, [bob.userId], ["hd-6"]);
  await testDb.db
    .updateTable("user_sources")
    .set({ hide_from_library: true })
    .where((eb) =>
      eb.or([
        eb.and([eb("user_id", "=", alice.userId), eb("source_id", "=", yt)]),
        eb.and([eb("user_id", "=", bob.userId), eb("source_id", "=", bobs)]),
      ]),
    )
    .execute();
});
afterAll(async () => {
  await testDb.close();
});

const app = (): OpenAPIHono =>
  asUser(createApp({ db: testDb.db, version: "t", logger }, { webDist: null }), alice);

async function titles(query: string): Promise<string[]> {
  const res = await app().request(`/api/library${query}`);
  expect(res.status).toBe(200);
  return LibraryPage.parse(await res.json())
    .entries.map((e) => e.title)
    .sort();
}

describe("GET /api/library?hidden", () => {
  it("leaves out what the caller's hiding playlists hold, of either kind, with false", async () => {
    expect(await titles("?hidden=false")).toEqual([
      "In Bob's hiding YouTube playlist",
      "In a showing playlist",
      "In no playlist",
    ]);
  });

  it("keeps only those with true", async () => {
    expect(await titles("?hidden=true")).toEqual([
      "In a hiding YouTube playlist",
      "In a hiding and a showing playlist",
      "In a hiding playlist",
    ]);
  });

  it("lists everything without it", async () => {
    expect(await titles("")).toHaveLength(6);
  });

  it("refuses anything but true or false (400)", async () => {
    expect((await app().request("/api/library?hidden=yes")).status).toBe(400);
  });
});
