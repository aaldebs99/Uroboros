import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryItem, LibraryPage, PlaylistDetail, PlaylistSummary } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let alice: SignedIn;
let bob: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await signedIn(testDb.db, { username: "plalice" });
  bob = await signedIn(testDb.db, { username: "plbob" });
});

afterAll(async () => {
  await testDb.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: testDb.db, version: "t", logger }, { webDist: null }), s);

const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

async function create(s: SignedIn, name: string, entryIds?: string[]) {
  const res = await send(s, "POST", "/api/playlists", { name, ...(entryIds ? { entryIds } : {}) });
  expect(res.status).toBe(201);
  return PlaylistDetail.parse(await res.json());
}

async function order(s: SignedIn, playlistId: string): Promise<string[]> {
  const res = await send(s, "GET", `/api/library?playlist=${playlistId}`);
  expect(res.status).toBe(200);
  return LibraryPage.parse(await res.json()).entries.map((e) => e.id);
}

/** Three new entries of the person's, in creation order. */
async function entries(s: SignedIn): Promise<[string, string, string]> {
  const one = async () => (await seedEntry(testDb.db, s.userId)).entryId;
  return [await one(), await one(), await one()];
}

/** A YouTube playlist Alice queued, holding `videoIds` in that order. */
async function youtubePlaylist(userId: string, videoIds: string[], title = "Shorts") {
  const source = await testDb.db
    .insertInto("sources")
    .values({
      extractor: "youtube",
      source_id: `PL${String(Math.random()).slice(2)}`,
      kind: "playlist",
      title,
      url: "https://www.youtube.com/playlist?list=PLx",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await testDb.db
    .insertInto("user_sources")
    .values({ user_id: userId, source_id: source.id })
    .execute();
  for (const [position, video_id] of videoIds.entries()) {
    await testDb.db
      .insertInto("source_items")
      .values({ source_id: source.id, extractor: "youtube", video_id, position })
      .execute();
  }
  return source.id;
}

describe("manual playlists", () => {
  it("creates, lists and renames a playlist", async () => {
    const p = await create(alice, "Road trip");
    expect(p).toMatchObject({ kind: "manual", name: "Road trip", count: 0, description: null });
    const renamed = await send(alice, "PATCH", `/api/playlists/${p.id}`, {
      name: "Holiday",
      description: "For the car",
    });
    expect(renamed.status).toBe(200);
    expect(PlaylistDetail.parse(await renamed.json())).toMatchObject({
      name: "Holiday",
      description: "For the car",
    });
    const list = z
      .array(PlaylistSummary)
      .parse(await (await send(alice, "GET", "/api/playlists")).json());
    expect(list.map((x) => x.name)).toContain("Holiday");
  });

  it("appends without duplicates and keeps order", async () => {
    const [a, b, c] = await entries(alice);
    const p = await create(alice, "Order");
    expect(
      (await send(alice, "POST", `/api/playlists/${p.id}/items`, { entryIds: [a, b] })).status,
    ).toBe(204);
    expect(
      (await send(alice, "POST", `/api/playlists/${p.id}/items`, { entryIds: [b, c] })).status,
    ).toBe(204);
    expect(await order(alice, p.id)).toEqual([a, b, c]);
    const detail = PlaylistDetail.parse(
      await (await send(alice, "GET", `/api/playlists/${p.id}`)).json(),
    );
    expect(detail.count).toBe(3);
  });

  it("replacing items refuses a foreign entry", async () => {
    const [a, b, c] = await entries(alice);
    const [theirs] = await entries(bob);
    const p = await create(alice, "Replace", [a, b, c]);
    const refused = await send(alice, "PUT", `/api/playlists/${p.id}/items`, {
      entryIds: [a, theirs],
    });
    expect(refused.status).toBe(400);
    expect(await order(alice, p.id)).toEqual([a, b, c]);
    expect(
      (await send(alice, "PUT", `/api/playlists/${p.id}/items`, { entryIds: [c, a] })).status,
    ).toBe(204);
    expect(await order(alice, p.id)).toEqual([c, a]);
  });

  it("removes one item", async () => {
    const [a, b] = await entries(alice);
    const p = await create(alice, "Remove", [a, b]);
    expect((await send(alice, "DELETE", `/api/playlists/${p.id}/items/${a}`)).status).toBe(204);
    expect(await order(alice, p.id)).toEqual([b]);
  });

  it("a duplicate in the body is 400", async () => {
    const [a] = await entries(alice);
    const p = await create(alice, "Dupes");
    const res = await send(alice, "PUT", `/api/playlists/${p.id}/items`, { entryIds: [a, a] });
    expect(res.status).toBe(400);
  });

  it("more than 5000 is 400", async () => {
    const p = await create(alice, "Huge");
    const ids = Array.from({ length: 5001 }, () => crypto.randomUUID());
    const res = await app(alice).request(`/api/playlists/${p.id}/items`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryIds: ids }),
    });
    expect([400, 413]).toContain(res.status);
  });

  it("another person's playlist is 404", async () => {
    const p = await create(alice, "Private");
    expect((await send(bob, "GET", `/api/playlists/${p.id}`)).status).toBe(404);
    expect((await send(bob, "PATCH", `/api/playlists/${p.id}`, { name: "Mine" })).status).toBe(404);
    expect((await send(bob, "DELETE", `/api/playlists/${p.id}`)).status).toBe(404);
    expect((await send(bob, "GET", `/api/library?playlist=${p.id}`)).status).toBe(404);
  });

  it("moves an entry to a position, the end when past it, shifting the others", async () => {
    const [a, b, c] = await entries(alice);
    const p = await create(alice, "Moving", [a, b, c]);
    const move = (entryId: string, position: number) =>
      send(alice, "POST", `/api/playlists/${p.id}/items/${entryId}/move`, { position });
    expect((await move(c, 0)).status).toBe(204);
    expect(await order(alice, p.id)).toEqual([c, a, b]);
    expect((await move(c, 1)).status).toBe(204);
    expect(await order(alice, p.id)).toEqual([a, c, b]);
    expect((await move(a, 99)).status).toBe(204);
    expect(await order(alice, p.id)).toEqual([c, b, a]);
    expect((await move(a, -1)).status).toBe(400);
    // Not in the playlist, or a YouTube playlist.
    const [outside] = await entries(alice);
    expect((await move(outside, 0)).status).toBe(404);
    const e = await seedEntry(testDb.db, alice.userId, { videoId: "yt-move-1" });
    const sourceId = await youtubePlaylist(alice.userId, ["yt-move-1"]);
    expect(
      (
        await send(alice, "POST", `/api/playlists/${sourceId}/items/${e.entryId}/move`, {
          position: 0,
        })
      ).status,
    ).toBe(409);
    expect(await order(alice, p.id)).toEqual([c, b, a]);
  });

  it("another person can neither read nor change what a playlist holds", async () => {
    const [a, b] = await entries(alice);
    const [theirs] = await entries(bob);
    const p = await create(alice, "Not yours", [a, b]);
    const tries: [string, string, unknown?][] = [
      ["POST", `/api/playlists/${p.id}/items`, { entryIds: [theirs] }],
      ["PUT", `/api/playlists/${p.id}/items`, { entryIds: [theirs] }],
      ["POST", `/api/playlists/${p.id}/items/${a}/move`, { position: 1 }],
      ["DELETE", `/api/playlists/${p.id}/items/${a}`],
      ["POST", `/api/playlists/${p.id}/copy`],
    ];
    for (const [method, path, body] of tries) {
      expect([method, path, (await send(bob, method, path, body)).status]).toEqual([
        method,
        path,
        404,
      ]);
    }
    expect(await order(alice, p.id)).toEqual([a, b]);
    const bobs = z
      .array(PlaylistSummary)
      .parse(await (await send(bob, "GET", "/api/playlists")).json());
    expect(bobs.map((x) => x.name)).not.toContain("Not yours");
  });

  it("deletes a playlist", async () => {
    const p = await create(alice, "Gone");
    expect((await send(alice, "DELETE", `/api/playlists/${p.id}`)).status).toBe(204);
    expect((await send(alice, "GET", `/api/playlists/${p.id}`)).status).toBe(404);
  });

  it("a YouTube playlist lists with kind youtube and cannot be renamed (409)", async () => {
    const e = await seedEntry(testDb.db, alice.userId, { videoId: "yt-kind-1" });
    const sourceId = await youtubePlaylist(alice.userId, ["yt-kind-1"]);
    const list = z
      .array(PlaylistSummary)
      .parse(await (await send(alice, "GET", "/api/playlists")).json());
    const yt = list.find((x) => x.id === sourceId);
    expect(yt).toMatchObject({ kind: "youtube", name: "Shorts", count: 1 });
    expect(list.findIndex((x) => x.kind === "youtube")).toBeGreaterThan(
      list.findLastIndex((x) => x.kind === "manual"),
    );
    expect(
      (await send(alice, "PATCH", `/api/playlists/${sourceId}`, { name: "Mine" })).status,
    ).toBe(409);
    expect(
      (await send(alice, "POST", `/api/playlists/${sourceId}/items`, { entryIds: [e.entryId] }))
        .status,
    ).toBe(409);
    expect((await send(alice, "DELETE", `/api/playlists/${sourceId}`)).status).toBe(409);
    expect((await send(bob, "GET", `/api/playlists/${sourceId}`)).status).toBe(404);
  });

  it("Save as my playlist copies the caller's videos from a YouTube playlist in its order", async () => {
    const second = await seedEntry(testDb.db, alice.userId, { videoId: "yt-copy-2" });
    const first = await seedEntry(testDb.db, alice.userId, { videoId: "yt-copy-1" });
    const sourceId = await youtubePlaylist(
      alice.userId,
      ["yt-copy-1", "yt-missing", "yt-copy-2"],
      "Mix",
    );
    const res = await send(alice, "POST", `/api/playlists/${sourceId}/copy`);
    expect(res.status).toBe(201);
    const copy = PlaylistDetail.parse(await res.json());
    expect(copy).toMatchObject({ kind: "manual", name: "Mix", count: 2 });
    expect(await order(alice, copy.id)).toEqual([first.entryId, second.entryId]);
  });

  it("the library lists a playlist in position order", async () => {
    const [a, b] = await entries(alice);
    const p = await create(alice, "Listed", [b, a]);
    expect(await order(alice, p.id)).toEqual([b, a]);
    const both = await send(alice, "GET", `/api/library?playlist=${p.id}&source=${p.id}`);
    expect(both.status).toBe(400);
  });

  it("an item lists the caller's manual playlists holding it", async () => {
    const [a] = await entries(alice);
    const p = await create(alice, "Holder", [a]);
    const item = LibraryItem.parse(await (await send(alice, "GET", `/api/library/${a}`)).json());
    expect(item.playlists).toEqual([{ id: p.id, name: "Holder" }]);
  });
});
