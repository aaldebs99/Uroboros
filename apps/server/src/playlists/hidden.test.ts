import type { OpenAPIHono } from "@hono/zod-openapi";
import { PlaylistDetail, PlaylistSummary } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedYouTubePlaylist } from "../../test/playlists.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";

/** `PUT /api/playlists/{id}/hidden` (docs/library.md "Hidden playlists"). */

const logger = pino({ level: "silent" });
let testDb: TestDb;
let alice: SignedIn;
let bob: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await signedIn(testDb.db, { username: "phalice" });
  bob = await signedIn(testDb.db, { username: "phbob" });
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

const hide = (s: SignedIn, id: string, hidden: unknown) =>
  send(s, "PUT", `/api/playlists/${id}/hidden`, { hidden });

async function detail(s: SignedIn, id: string) {
  const res = await send(s, "GET", `/api/playlists/${id}`);
  expect(res.status).toBe(200);
  return PlaylistDetail.parse(await res.json());
}

async function list(s: SignedIn) {
  const res = await send(s, "GET", "/api/playlists");
  expect(res.status).toBe(200);
  return z.array(PlaylistSummary).parse(await res.json());
}

async function create(s: SignedIn, name: string) {
  const res = await send(s, "POST", "/api/playlists", { name });
  expect(res.status).toBe(201);
  return PlaylistDetail.parse(await res.json());
}

describe("hiding a playlist from the library", () => {
  it("starts a new playlist showing", async () => {
    expect((await create(alice, "Fresh")).hideFromLibrary).toBe(false);
  });

  it("hides and shows a manual playlist, which says so in its detail and the list", async () => {
    const p = await create(alice, "Music");
    expect((await hide(alice, p.id, true)).status).toBe(204);
    expect((await detail(alice, p.id)).hideFromLibrary).toBe(true);
    expect((await list(alice)).find((x) => x.id === p.id)?.hideFromLibrary).toBe(true);
    expect((await hide(alice, p.id, false)).status).toBe(204);
    expect((await detail(alice, p.id)).hideFromLibrary).toBe(false);
  });

  it("hides a YouTube playlist for the caller alone, though others have it too", async () => {
    const id = await seedYouTubePlaylist(testDb.db, [alice.userId, bob.userId], []);
    expect((await hide(alice, id, true)).status).toBe(204);
    expect((await detail(alice, id)).hideFromLibrary).toBe(true);
    expect((await detail(bob, id)).hideFromLibrary).toBe(false);
  });

  it("leaves the playlist where it was in the list", async () => {
    const older = await create(alice, "Older");
    const newer = await create(alice, "Newer");
    const ids = async () =>
      (await list(alice)).map((x) => x.id).filter((x) => x === older.id || x === newer.id);
    expect(await ids()).toEqual([newer.id, older.id]);
    await hide(alice, older.id, true);
    expect(await ids()).toEqual([newer.id, older.id]);
  });

  it("is 404 for another person's playlist, of either kind, and changes nothing", async () => {
    const theirs = await create(bob, "Bob's");
    const theirYouTube = await seedYouTubePlaylist(testDb.db, [bob.userId], []);
    expect((await hide(alice, theirs.id, true)).status).toBe(404);
    expect((await hide(alice, theirYouTube, true)).status).toBe(404);
    expect((await detail(bob, theirs.id)).hideFromLibrary).toBe(false);
  });

  it("refuses a body without a yes or no (400)", async () => {
    const p = await create(alice, "Odd");
    expect((await hide(alice, p.id, "yes")).status).toBe(400);
    expect((await send(alice, "PUT", `/api/playlists/${p.id}/hidden`, {})).status).toBe(400);
  });
});
