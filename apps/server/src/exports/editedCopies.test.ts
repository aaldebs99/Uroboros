import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ClipItem, Export, PublicShare, ShareState } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedClip } from "../../test/clips.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";

/**
 * Copies and clips of a video with its owner's own details (docs/library.md#your-own-details):
 * named and shown as the owner of the entry they were cut from shows it.
 */

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let alice: SignedIn;
let bob: SignedIn;
let film: SeededEntry;
let clip: { exportId: string };

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-edcopies-")),
    layout: DEFAULT_LAYOUT,
  });
  alice = await signedIn(t.db, { username: "edcalice" });
  bob = await signedIn(t.db, { username: "edcbob" });
  film = await seedEntry(t.db, alice.userId, {
    title: "Site title",
    thumbnail: true,
    media: { channel: "Site Channel" },
  });
  await t.db
    .insertInto("media_edits")
    .values({
      user_id: alice.userId,
      media_id: film.mediaId,
      title: "Alice's title",
      channel: "Alice's channel",
      channel_extractor: "youtube",
    })
    .execute();
  clip = await seedClip(t.db, alice.userId, { entryId: film.entryId, done: { store } });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const opts = () => ({ db: t.db, version: "t", logger, store, downloads: h.ctx });
const app = (s: SignedIn): OpenAPIHono => asUser(createApp(opts(), { webDist: null }), s);
const anon = (path: string) => createApp(opts(), { webDist: null }).request(path);
const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
const json = async <T>(res: Response, schema: z.ZodType<T>): Promise<T> => {
  expect(res.status).toBe(200);
  return schema.parse(await res.json());
};
const copies = async (s: SignedIn) => json(await app(s).request("/api/exports"), z.array(Export));

describe("copies of a video with its owner's own details", () => {
  it("lists and names the owner's copy by their title", async () => {
    expect((await copies(alice)).map((c) => c.title)).toEqual(["Alice's title"]);
    const file = await send(alice, "GET", `/api/exports/${clip.exportId}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain("Alice");
  });

  it("shows a shared clip, by people or a link, in the owner's version", async () => {
    const put = await send(alice, "PUT", `/api/shares/clip/${clip.exportId}/link`, {
      allowDownload: true,
      expiresAt: null,
    });
    const state = await json(put, ShareState);
    expect(state.title).toContain("Alice's title");
    const share = await json(await anon(`/api/public/s/${state.link?.code ?? ""}`), PublicShare);
    expect(share.clip).toMatchObject({
      title: "Alice's title (clip 1:02–1:30)",
      channel: "Alice's channel",
    });
    await send(alice, "PUT", `/api/shares/clip/${clip.exportId}/people`, {
      people: [{ kind: "user", id: bob.userId }],
      expiresAt: null,
    });
    const item = await json(await send(bob, "GET", `/api/clips/${clip.exportId}`), ClipItem);
    expect(item).toMatchObject({
      title: "Alice's title (clip 1:02–1:30)",
      channel: "Alice's channel",
    });
  });

  it("names a copy cut from a shared video as its owner shows it", async () => {
    await send(alice, "PUT", `/api/shares/entry/${film.entryId}/people`, {
      people: [{ kind: "user", id: bob.userId }],
      expiresAt: null,
    });
    const made = await send(bob, "POST", `/api/library/${film.entryId}/export`, {
      clip: { start: 10, end: 20 },
    });
    expect(made.status).toBe(201);
    expect(Export.parse(await made.json()).title).toBe("Alice's title");
    expect((await copies(bob)).map((c) => c.title)).toEqual(["Alice's title"]);
  });
});
