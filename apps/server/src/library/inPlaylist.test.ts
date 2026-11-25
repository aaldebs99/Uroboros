import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryPage } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let alice: SignedIn;

/** A YouTube playlist that `userId` has, listing these videos in order. */
async function youtubePlaylist(userId: string, id: string, videoIds: string[]): Promise<void> {
  const s = await testDb.db
    .insertInto("sources")
    .values({
      extractor: "youtubetab",
      source_id: id,
      kind: "playlist",
      url: "https://x.example/p",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await testDb.db.insertInto("user_sources").values({ user_id: userId, source_id: s.id }).execute();
  await testDb.db
    .insertInto("source_items")
    .values(
      videoIds.map((video_id, position) => ({
        source_id: s.id,
        extractor: "youtube",
        video_id,
        position,
      })),
    )
    .execute();
}

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await signedIn(testDb.db, { username: "ipalice" });
  const bob = await signedIn(testDb.db, { username: "ipbob" });
  // Alice has four videos: in a YouTube playlist of hers, in a playlist she made, in a YouTube
  // playlist only Bob has, and in none.
  await seedEntry(testDb.db, alice.userId, { videoId: "ip-a", title: "Alpha in her mix" });
  const own = await seedEntry(testDb.db, alice.userId, { videoId: "ip-b", title: "Bravo listed" });
  await seedEntry(testDb.db, alice.userId, { videoId: "ip-c", title: "Charlie in his mix" });
  await seedEntry(testDb.db, alice.userId, { videoId: "ip-d", title: "Delta loose" });
  await youtubePlaylist(alice.userId, "PL-alice", ["ip-a", "ip-x"]);
  await youtubePlaylist(bob.userId, "PL-bob", ["ip-c"]);
  const playlist = await testDb.db
    .insertInto("playlists")
    .values({ user_id: alice.userId, name: "Mine" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await testDb.db
    .insertInto("playlist_items")
    .values({ playlist_id: playlist.id, user_id: alice.userId, entry_id: own.entryId, position: 0 })
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

describe("GET /api/library?inPlaylist", () => {
  it("leaves out the videos in any of the caller's playlists, of either kind, with false", async () => {
    expect(await titles("?inPlaylist=false")).toEqual(["Charlie in his mix", "Delta loose"]);
  });

  it("keeps only those videos with true", async () => {
    expect(await titles("?inPlaylist=true")).toEqual(["Alpha in her mix", "Bravo listed"]);
  });

  it("narrows a search the same way", async () => {
    expect(await titles("?q=mix")).toEqual(["Alpha in her mix", "Charlie in his mix"]);
    expect(await titles("?q=mix&inPlaylist=false")).toEqual(["Charlie in his mix"]);
  });

  it("refuses anything but true or false (400)", async () => {
    expect((await app().request("/api/library?inPlaylist=maybe")).status).toBe(400);
  });
});
