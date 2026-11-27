import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryItem, PublicItem, PublicShare, ShareState, SharedWithMe } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";
import { ogTags } from "./og.ts";

/**
 * What a person shares in their own details (docs/library.md#your-own-details): whoever a share
 * reaches, or a public link, sees the owner's version; Save names the file by it.
 */

const logger = pino({ level: "silent" });
let t: TestDb;
let store: MediaStore;
let alice: SignedIn;
let bob: SignedIn;
let film: SeededEntry;

beforeAll(async () => {
  t = await TestDb.create();
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-edsh-")),
    layout: DEFAULT_LAYOUT,
  });
  const src = join(await mkdtemp(join(tmpdir(), "uroboros-edsh-src-")), "f");
  await writeFile(src, "0123456789");
  await store.put("edsh.mp4", src, "video/mp4");
  alice = await signedIn(t.db, { username: "edshalice" });
  bob = await signedIn(t.db, { username: "edshbob" });
  film = await seedEntry(t.db, alice.userId, {
    title: "Site title",
    storageKey: "edsh.mp4",
    media: { channel: "Site Channel", description: "The site's words" },
  });
  await t.db
    .insertInto("media_edits")
    .values({
      user_id: alice.userId,
      media_id: film.mediaId,
      title: "Alice's title",
      description: "Alice's words",
      channel: "Alice's channel",
      channel_extractor: "youtube",
    })
    .execute();
});
afterAll(async () => {
  await t.close();
});

const opts = () => ({ db: t.db, version: "t", logger, store });
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

let n = 0;
async function linkTo(entryId: string) {
  const code = `edsh${String(++n)}xxxxxxxxxxxxxxxxxxxx`.slice(0, 22);
  await t.db
    .insertInto("shares")
    .values({ owner_id: alice.userId, mode: "link", code, entry_id: entryId, allow_download: true })
    .execute();
  return code;
}

describe("sharing a video with its owner's own details", () => {
  it("shows the people a share reaches the owner's version", async () => {
    const put = await send(alice, "PUT", `/api/shares/entry/${film.entryId}/people`, {
      people: [{ kind: "user", id: bob.userId }],
      expiresAt: null,
    });
    expect((await json(put, ShareState)).title).toBe("Alice's title");
    const withMe = await json(await send(bob, "GET", "/api/shared"), z.array(SharedWithMe));
    expect(withMe.map((s) => s.title)).toEqual(["Alice's title"]);
    const item = await json(await send(bob, "GET", `/api/library/${film.entryId}`), LibraryItem);
    expect(item).toMatchObject({
      title: "Alice's title",
      description: "Alice's words",
      channel: "Alice's channel",
    });
  });

  it("shows a public link, its item, its preview tags and its file in the owner's version", async () => {
    const code = await linkTo(film.entryId);
    const share = await json(await anon(`/api/public/s/${code}`), PublicShare);
    expect(share.title).toBe("Alice's title");
    expect(share.items.map((i) => [i.title, i.channel])).toEqual([
      ["Alice's title", "Alice's channel"],
    ]);
    const item = await json(await anon(`/api/public/s/${code}/items/${film.entryId}`), PublicItem);
    expect(item).toMatchObject({
      title: "Alice's title",
      channel: "Alice's channel",
      description: "Alice's words",
    });
    const tags = (await ogTags(t.db, code, "https://uro.example")).tags;
    expect(tags).toContain('<meta property="og:title" content="Alice&#39;s title">');
    expect(tags).toContain('<meta property="og:description" content="Alice&#39;s words">');
    const file = await anon(item.fileUrl ?? "");
    expect(file.headers.get("content-disposition")).toContain("Alice");
  });

  it("names a saved file by the person's title", async () => {
    const file = await send(alice, "GET", `/api/library/${film.entryId}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain("Alice");
  });
});
