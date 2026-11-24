import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  ChannelSummary,
  LibraryItem,
  LibraryPage,
  PlaylistSummary,
  PublicShare,
} from "@uroboros/contract";
import { pino } from "pino";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry, seedProfileless, type SeededEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";
import { ogTags } from "../sharing/og.ts";

/** Entries whose rendition has no format profile: uploads, and downloads whose profile is gone. */

const logger = pino({ level: "silent" });
let t: TestDb;
let store: MediaStore;
let alice: SignedIn;
let upload: SeededEntry;
let orphan: SeededEntry;
let download: SeededEntry;
const VERSIONED = /^\/api\/library\/[0-9a-f-]+\/thumbnail\?v=[0-9a-f]{8}$/;

beforeAll(async () => {
  t = await TestDb.create();
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-noprofile-")),
    layout: DEFAULT_LAYOUT,
  });
  const src = join(await mkdtemp(join(tmpdir(), "uroboros-src-")), "f");
  await writeFile(src, "0123456789");
  alice = await signedIn(t.db, { username: "noprofile" });
  upload = await seedProfileless(t.db, alice.userId, {
    title: "Holiday: day one",
    channel: "Alice A",
    storageKey: "up/holiday.mp4",
    thumbnailKey: "up/holiday.jpg",
  });
  orphan = await seedProfileless(t.db, alice.userId, { extractor: "youtube", title: "Kept" });
  download = await seedEntry(t.db, alice.userId, { title: "Downloaded", thumbnail: true });
  await store.put("up/holiday.mp4", src, "video/mp4");
  await store.put("up/holiday.jpg", src, "image/jpeg");
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn = alice): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger, store }, { webDist: null }), s);

async function json<T>(schema: z.ZodType<T>, path: string): Promise<T> {
  const res = await app().request(path);
  expect(res.status).toBe(200);
  return schema.parse(await res.json());
}

describe("entries without a format profile", () => {
  it("are listed, with no profile name, their origin and a versioned thumbnail", async () => {
    const page = await json(LibraryPage, "/api/library");
    const byId = new Map(page.entries.map((e) => [e.id, e]));
    expect(byId.get(upload.entryId)).toMatchObject({
      title: "Holiday: day one",
      channel: "Alice A",
      profileName: null,
      origin: "upload",
    });
    expect(byId.get(orphan.entryId)).toMatchObject({ profileName: null, origin: "download" });
    expect(byId.get(download.entryId)).toMatchObject({ origin: "download" });
    expect(byId.get(download.entryId)?.profileName).toEqual(expect.any(String));
    for (const e of page.entries) expect(e.thumbnailUrl).toMatch(VERSIONED);
  });

  it("open as an item, stream, and download as <title>.<ext>", async () => {
    const item = await json(LibraryItem, `/api/library/${upload.entryId}`);
    expect(item).toMatchObject({ profileName: null, origin: "upload", webpageUrl: null });
    expect((await app().request(`/api/library/${upload.entryId}/stream`)).status).toBe(200);
    const file = await app().request(`/api/library/${upload.entryId}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("Holiday: day one.mp4")}`,
    );
    const thumb = await app().request(item.thumbnailUrl ?? "");
    expect(thumb.status).toBe(200);
  });

  it("group under their creator, with a versioned cover", async () => {
    const channels = await json(z.array(ChannelSummary), "/api/library/channels");
    const mine = channels.find((c) => c.name === "Alice A");
    expect(mine).toMatchObject({ extractor: "upload", count: 1 });
    expect(mine?.coverThumbnailUrl).toMatch(VERSIONED);
  });

  it("cover a playlist, and its shared link keeps them and its preview image", async () => {
    const pl = await t.db
      .insertInto("playlists")
      .values({ user_id: alice.userId, name: "Trips" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto("playlist_items")
      .values({ playlist_id: pl.id, user_id: alice.userId, entry_id: upload.entryId, position: 0 })
      .execute();
    const lists = await json(z.array(PlaylistSummary), "/api/playlists");
    const trips = lists.find((p) => p.id === pl.id);
    expect(trips?.coverThumbnailUrl).toMatch(VERSIONED);
    const code = "noprofilelink000000001";
    await t.db
      .insertInto("shares")
      .values({ owner_id: alice.userId, mode: "link", code, playlist_id: pl.id })
      .execute();
    const share = await json(PublicShare, `/api/public/s/${code}`);
    expect(share.items.map((i) => i.id)).toEqual([upload.entryId]);
    expect(share.items[0]?.thumbnailUrl).toMatch(
      new RegExp(`^/api/public/s/${code}/items/${upload.entryId}/thumbnail\\?v=[0-9a-f]{8}$`),
    );
    const og = await ogTags(t.db, code, "https://uro.example");
    expect(og.tags).toContain(`items/${upload.entryId}/thumbnail`);
  });
});
