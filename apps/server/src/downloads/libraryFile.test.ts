import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { TestS3 } from "../../test/testS3.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;
let entryId: string;
let mediaId: string;
const KEY = "Blender/2008-05-20 Big Buck Bunny [bbb]/Big Buck Bunny [Best available].mp4";

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-lib-")),
    layout: DEFAULT_LAYOUT,
  });
  const src = join(await mkdtemp(join(tmpdir(), "uroboros-src-")), "f");
  await writeFile(src, "0123456789");
  await store.put(KEY, src, "video/mp4");
  await store.put("thumb.jpg", src, "image/jpeg");
  await store.put(".previews/clip.mp4", src, "video/mp4");
  alice = await signedIn(testDb.db, { username: "falice" });
  bob = await signedIn(testDb.db, { username: "fbob" });
  carol = await signedIn(testDb.db, { username: "fcarol" });
  const p = await seededDefault(testDb.db);
  const media = await testDb.db
    .insertInto("media")
    .values({
      extractor: "youtube",
      video_id: "bbb",
      title: "Big Buck Bunny",
      thumbnail_key: "thumb.jpg",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await testDb.db
    .insertInto("renditions")
    .values({
      media_id: media.id,
      profile_id: p.id,
      profile_revision: p.revision,
      storage_key: KEY,
      size_bytes: 10,
      container: "mp4",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const e = await testDb.db
    .insertInto("library_entries")
    .values({ user_id: alice.userId, media_id: media.id, rendition_id: r.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  entryId = e.id;
  mediaId = media.id;
  const share = await testDb.db
    .insertInto("shares")
    .values({ owner_id: alice.userId, entry_id: e.id, mode: "people" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await testDb.db
    .insertInto("share_people")
    .values({ share_id: share.id, user_id: carol.userId })
    .execute();
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

const app = (s: SignedIn, st: MediaStore = store): OpenAPIHono =>
  asUser(createApp({ db: testDb.db, version: "t", logger, store: st }, { webDist: null }), s);

describe("GET /api/library/{id}/file", () => {
  it("streams the whole file as an attachment named after the title and profile", async () => {
    const res = await app(alice).request(`/api/library/${entryId}/file`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("Big Buck Bunny [Best available].mp4")}`,
    );
  });

  it("serves a byte range (206) and refuses one past the end (416)", async () => {
    const part = await app(alice).request(`/api/library/${entryId}/file`, {
      headers: { range: "bytes=0-3" },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 0-3/10");
    expect(await part.text()).toBe("0123");
    const bad = await app(alice).request(`/api/library/${entryId}/file`, {
      headers: { range: "bytes=999999-" },
    });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */10");
  });

  it("answers 404 for another person's entry", async () => {
    expect((await app(bob).request(`/api/library/${entryId}/file`)).status).toBe(404);
  });

  it("redirects to a presigned URL when the S3 store has a public endpoint", async () => {
    const s3 = createStore(await TestS3.bucket({ publicUrl: "https://media.example.org" }));
    const res = await app(alice, s3).request(`/api/library/${entryId}/file`);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location") ?? "").origin).toBe("https://media.example.org");
  });
});

describe("GET /api/library/{id}/thumbnail", () => {
  it("serves the media's thumbnail to the entry's owner", async () => {
    const res = await app(alice).request(`/api/library/${entryId}/thumbnail`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect((await app(bob).request(`/api/library/${entryId}/thumbnail`)).status).toBe(404);
  });
});

describe("GET /api/library/{id}/preview", () => {
  it("answers 404 until the preview is made", async () => {
    // Not made (the next test makes it; this one must not depend on running first).
    await testDb.db
      .updateTable("media")
      .set({ preview_key: null })
      .where("id", "=", mediaId)
      .execute();
    const res = await app(alice).request(`/api/library/${entryId}/preview`);
    expect(res.status).toBe(404);
  });

  it("serves the clip, in ranges, to the owner and whoever it is shared with", async () => {
    await testDb.db
      .updateTable("media")
      .set({ preview_key: ".previews/clip.mp4" })
      .where("id", "=", mediaId)
      .execute();
    const res = await app(alice).request(`/api/library/${entryId}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-disposition")).toBeNull();
    const part = await app(carol).request(`/api/library/${entryId}/preview`, {
      headers: { range: "bytes=0-3" },
    });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("0123");
    expect((await app(bob).request(`/api/library/${entryId}/preview`)).status).toBe(404);
  });
});
