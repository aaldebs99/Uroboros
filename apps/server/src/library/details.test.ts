import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryItem, LibraryPage } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry, seedProfileless } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT, type StorageConfig } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";

/** Editing an uploaded video's details and thumbnail (docs/uploads.md#editing). */

const logger = pino({ level: "silent" });
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
let t: TestDb;
let storage: StorageConfig;
let store: MediaStore;
let alice: SignedIn;
let bob: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  storage = {
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-details-")),
    layout: DEFAULT_LAYOUT,
  };
  store = createStore(storage);
  alice = await signedIn(t.db, { username: "detalice" });
  bob = await signedIn(t.db, { username: "detbob" });
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger, store, storage }, { webDist: null }), s);

const patch = (s: SignedIn, id: string, json: unknown) =>
  app(s).request(`/api/library/${id}/details`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(json),
  });
const putThumb = (s: SignedIn, id: string, bytes: Uint8Array) =>
  app(s).request(`/api/library/${id}/thumbnail`, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: bytes,
  });

async function mine(title = "Old") {
  const key = `up/${String(Math.random())}.mp4`;
  const thumb = `up/${String(Math.random())}.jpg`;
  const src = join(storage.kind === "filesystem" ? storage.root : "", "src.bin");
  await writeFile(src, "0123456789");
  await store.put(thumb, src, "image/jpeg");
  return seedProfileless(t.db, alice.userId, {
    title,
    channel: "Alice",
    uploadedBy: alice.userId,
    storageKey: key,
    thumbnailKey: thumb,
  });
}

async function item(s: SignedIn, id: string): Promise<LibraryItem> {
  return LibraryItem.parse(await (await app(s).request(`/api/library/${id}`)).json());
}

describe("editing an upload's details", () => {
  it("lets the uploader change the title, description and creator, which search finds", async () => {
    const e = await mine();
    expect((await item(alice, e.entryId)).editable).toBe(true);
    const res = await patch(alice, e.entryId, {
      title: "  Snorkelling at dawn ",
      description: " ",
      creator: "Nan",
    });
    expect(res.status).toBe(200);
    expect(LibraryItem.parse(await res.json())).toMatchObject({
      title: "Snorkelling at dawn",
      description: null,
      channel: "Nan",
      editable: true,
    });
    const page = LibraryPage.parse(
      await (await app(alice).request("/api/library?q=snorkelling")).json(),
    );
    expect(page.entries.map((x) => x.id)).toEqual([e.entryId]);
  });

  it("is the uploader's alone, on their own entry; anyone else's edits are their own", async () => {
    const e = await mine();
    expect(
      (await patch(bob, e.entryId, { title: "X", description: null, creator: "X" })).status,
    ).toBe(404);
    // A downloaded video's details are the editor's own (docs/library.md#your-own-details).
    const download = await seedEntry(t.db, alice.userId);
    expect((await item(alice, download.entryId)).editable).toBe(false);
    const res = await patch(alice, download.entryId, {
      title: "X",
      description: null,
      creator: "X",
    });
    expect(res.status).toBe(200);
    expect(LibraryItem.parse(await res.json())).toMatchObject({ editable: false, edited: true });
    const theirs = await seedProfileless(t.db, alice.userId, { uploadedBy: bob.userId });
    expect((await item(alice, theirs.entryId)).editable).toBe(false);
    expect((await putThumb(alice, theirs.entryId, PNG)).status).toBe(403);
  });

  it("refuses a blank title", async () => {
    const e = await mine();
    expect(
      (await patch(alice, e.entryId, { title: " ", description: null, creator: "A" })).status,
    ).toBe(400);
  });
});

describe("replacing an upload's thumbnail", () => {
  it("gives it a new URL at once, and sends the old file to the trash", async () => {
    const e = await mine();
    const before = await item(alice, e.entryId);
    const old = await t.db
      .selectFrom("media")
      .select("thumbnail_key")
      .where("id", "=", e.mediaId)
      .executeTakeFirstOrThrow();
    const res = await putThumb(alice, e.entryId, PNG);
    expect(res.status).toBe(200);
    const after = LibraryItem.parse(await res.json());
    expect(after.thumbnailUrl).not.toBe(before.thumbnailUrl);
    const now = await t.db
      .selectFrom("media")
      .select(["thumbnail_key", "thumbnail_bytes"])
      .where("id", "=", e.mediaId)
      .executeTakeFirstOrThrow();
    expect(now.thumbnail_key).toMatch(/\.png$/);
    expect(await store.stat(now.thumbnail_key ?? "")).toEqual({ size: PNG.length });
    expect(now.thumbnail_bytes).toBe(String(PNG.length));
    const trash = await t.db.selectFrom("storage_trash").select("key").execute();
    expect(trash.map((r) => r.key)).toContain(old.thumbnail_key);
    const shown = await app(alice).request(after.thumbnailUrl ?? "");
    expect(shown.status).toBe(200);
  });

  it("takes only an image", async () => {
    const e = await mine();
    expect((await putThumb(alice, e.entryId, Buffer.from("plain text"))).status).toBe(400);
  });

  it("keeps one thumbnail when two replace it at once, and trashes every other", async () => {
    const e = await mine();
    const old = await t.db
      .selectFrom("media")
      .select("thumbnail_key")
      .where("id", "=", e.mediaId)
      .executeTakeFirstOrThrow();
    const results = await Promise.all([
      putThumb(alice, e.entryId, PNG),
      putThumb(alice, e.entryId, PNG),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const now = await t.db
      .selectFrom("media")
      .select("thumbnail_key")
      .where("id", "=", e.mediaId)
      .executeTakeFirstOrThrow();
    const trash = new Set(
      (await t.db.selectFrom("storage_trash").select("key").execute()).map((r) => r.key),
    );
    expect(trash.has(old.thumbnail_key ?? "")).toBe(true);
    expect(trash.has(now.thumbnail_key ?? "")).toBe(false);
    const all = await t.db
      .selectFrom("storage_trash")
      .select("key")
      .where("key", "like", "%.png")
      .execute();
    const ours = all.filter((r) => r.key.startsWith((now.thumbnail_key ?? "").split("[")[0] ?? ""));
    expect(ours).toHaveLength(1);
  });
});
