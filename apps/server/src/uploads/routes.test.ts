import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ApiErrorBody, Upload, UPLOAD_PART_BYTES } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { liveJobs } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT, type StorageConfig } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let root: string;
let storage: StorageConfig;
let store: MediaStore;

/** Tiny parts, so a test file is a few bytes (the filesystem takes any part size). */
const PART = 4;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  root = await mkdtemp(join(tmpdir(), "uroboros-uploads-"));
  storage = { kind: "filesystem", root, layout: DEFAULT_LAYOUT };
  store = createStore(storage);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

function app(s: SignedIn, partBytes = PART, st: MediaStore = store): OpenAPIHono {
  return asUser(
    createApp(
      {
        db: t.db,
        version: "t",
        logger,
        store: st,
        storage,
        downloads: h.ctx,
        uploadPartBytes: partBytes,
      },
      { webDist: null },
    ),
    s,
  );
}

const post = (a: OpenAPIHono, path: string, json?: unknown) =>
  a.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
const put = (a: OpenAPIHono, path: string, bytes: Uint8Array, type = "application/octet-stream") =>
  a.request(path, { method: "PUT", headers: { "content-type": type }, body: bytes });

async function create(a: OpenAPIHono, over: Record<string, unknown> = {}): Promise<Upload> {
  const res = await post(a, "/api/uploads", {
    filename: "Holiday.MP4",
    size: 10,
    title: "  Holiday  ",
    tags: ["Beach", "beach", "sea"],
    ...over,
  });
  expect(res.status).toBe(201);
  return Upload.parse(await res.json());
}

describe("starting an upload", () => {
  it("records it receiving, by the uploader unless named, with its tags once each", async () => {
    const me = await signedIn(t.db, { username: "upstart" });
    const up = await create(app(me));
    expect(up).toMatchObject({
      filename: "Holiday.MP4",
      title: "Holiday",
      size: 10,
      partSize: PART,
      state: "receiving",
      receivedParts: [],
      error: null,
      entryId: null,
    });
    const row = await t.db
      .selectFrom("uploads")
      .innerJoin("users", "users.id", "uploads.user_id")
      .select(["uploads.creator", "users.display_name", "uploads.tags", "uploads.ext"])
      .where("uploads.id", "=", up.id)
      .executeTakeFirstOrThrow();
    expect(row.creator).toBe(row.display_name);
    expect(row.tags).toEqual(["beach", "sea"]);
    expect(row.ext).toBe("mp4");
    const named = await create(app(me), { creator: "Grandpa" });
    const again = await t.db
      .selectFrom("uploads")
      .select("creator")
      .where("id", "=", named.id)
      .executeTakeFirstOrThrow();
    expect(again.creator).toBe("Grandpa");
  });

  it("refuses a file type it does not take, a file over the cap and a blank title", async () => {
    const me = await signedIn(t.db, { username: "uprefuse" });
    const a = app(me);
    const exe = await post(a, "/api/uploads", { filename: "x.exe", size: 10, title: "X" });
    expect(exe.status).toBe(400);
    const big = await post(a, "/api/uploads", {
      filename: "x.mp4",
      size: h.ctx.limits.uploadMaxBytes + 1,
      title: "X",
    });
    expect(big.status).toBe(413);
    expect(ApiErrorBody.parse(await big.json())).toEqual({
      code: "payload_too_large",
      message: "videos of up to 10 GiB can be uploaded",
    });
    expect(
      (await post(a, "/api/uploads", { filename: "x.mp4", size: 10, title: " " })).status,
    ).toBe(400);
  });

  it("takes at most five unfinished uploads a person, even sent at once", async () => {
    const me = await signedIn(t.db, { username: "upfive" });
    const a = app(me);
    const results = await Promise.all(
      Array.from({ length: 7 }, async () =>
        post(a, "/api/uploads", { filename: "x.mp4", size: 10, title: "X" }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
  });
});

describe("sending parts", () => {
  it("takes each part at its exact size, in any order, and lists what it has", async () => {
    const me = await signedIn(t.db, { username: "upparts" });
    const a = app(me);
    const up = await create(a);
    expect((await put(a, `/api/uploads/${up.id}/parts/3`, Buffer.from("ij"))).status).toBe(204);
    expect((await put(a, `/api/uploads/${up.id}/parts/1`, Buffer.from("abcd"))).status).toBe(204);
    expect((await put(a, `/api/uploads/${up.id}/parts/2`, Buffer.from("efg"))).status).toBe(400);
    expect((await put(a, `/api/uploads/${up.id}/parts/4`, Buffer.from("k"))).status).toBe(400);
    const res = await a.request(`/api/uploads/${up.id}`);
    expect(Upload.parse(await res.json()).receivedParts).toEqual([1, 3]);
  });

  it("completes only with every part, then hands it to the upload job", async () => {
    const me = await signedIn(t.db, { username: "upcomplete" });
    const a = app(me);
    const up = await create(a);
    await put(a, `/api/uploads/${up.id}/parts/1`, Buffer.from("abcd"));
    await put(a, `/api/uploads/${up.id}/parts/3`, Buffer.from("ij"));
    const early = await post(a, `/api/uploads/${up.id}/complete`);
    expect(early.status).toBe(409);
    await put(a, `/api/uploads/${up.id}/parts/2`, Buffer.from("efgh"));
    const done = await post(a, `/api/uploads/${up.id}/complete`);
    expect(done.status).toBe(200);
    expect(Upload.parse(await done.json()).state).toBe("processing");
    expect((await liveJobs(t.db, "upload")).map((j) => j.key)).toContain(`upload|${up.id}`);
    expect((await put(a, `/api/uploads/${up.id}/parts/1`, Buffer.from("abcd"))).status).toBe(409);
    expect((await post(a, `/api/uploads/${up.id}/complete`)).status).toBe(409);
  });

  it("takes a thumbnail by what its bytes are, up to 5 MiB", async () => {
    const me = await signedIn(t.db, { username: "upthumb" });
    const a = app(me);
    const up = await create(a);
    expect((await put(a, `/api/uploads/${up.id}/thumbnail`, PNG, "image/png")).status).toBe(204);
    const row = await t.db
      .selectFrom("uploads")
      .select("thumbnail_key")
      .where("id", "=", up.id)
      .executeTakeFirstOrThrow();
    expect(row.thumbnail_key).toMatch(/\.png$/);
    expect(await store.stat(row.thumbnail_key ?? "")).toEqual({ size: PNG.length });
    const text = await put(
      a,
      `/api/uploads/${up.id}/thumbnail`,
      Buffer.from("not an image"),
      "image/png",
    );
    expect(text.status).toBe(400);
    const huge = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await put(a, `/api/uploads/${up.id}/thumbnail`, huge, "image/png")).status).toBe(413);
  });

  it("takes a part over the JSON limit, while JSON bodies stay limited", async () => {
    const me = await signedIn(t.db, { username: "uplimit" });
    const part = 100 * 1024;
    const a = app(me, part);
    const up = await create(a, { size: part + 1 });
    expect((await put(a, `/api/uploads/${up.id}/parts/1`, Buffer.alloc(part, 1))).status).toBe(204);
    const json = await post(a, "/api/uploads", {
      filename: "x.mp4",
      size: 10,
      title: "x".repeat(70 * 1024),
    });
    expect(json.status).toBe(413);
  });

  it("sends 8 MiB parts by default", async () => {
    const me = await signedIn(t.db, { username: "updefault" });
    const a = asUser(
      createApp(
        { db: t.db, version: "t", logger, store, storage, downloads: h.ctx },
        { webDist: null },
      ),
      me,
    );
    expect((await create(a)).partSize).toBe(UPLOAD_PART_BYTES);
  });
});

describe("cancelling and other people", () => {
  it("cancels a receiving upload, leaving nothing in the store", async () => {
    const me = await signedIn(t.db, { username: "upcancel" });
    const a = app(me);
    const up = await create(a);
    await put(a, `/api/uploads/${up.id}/parts/1`, Buffer.from("abcd"));
    const { storage_key: key } = await t.db
      .selectFrom("uploads")
      .select("storage_key")
      .where("id", "=", up.id)
      .executeTakeFirstOrThrow();
    const dir = join(root, dirname(key));
    expect((await readdir(dir)).some((f) => f.endsWith(".tmp"))).toBe(true);
    expect((await a.request(`/api/uploads/${up.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await a.request(`/api/uploads/${up.id}`)).status).toBe(404);
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });

  it("keeps a cancelled upload whose store refused the abort, so it can be cancelled again", async () => {
    const me = await signedIn(t.db, { username: "upcancelfail" });
    let down = true;
    const flaky: MediaStore = {
      ...store,
      abortUpload: (key, uploadId) => {
        if (down) {
          down = false;
          return Promise.reject(new Error("the store is down"));
        }
        return store.abortUpload(key, uploadId);
      },
    };
    const a = app(me, PART, flaky);
    const up = await create(a);
    expect((await a.request(`/api/uploads/${up.id}`, { method: "DELETE" })).status).toBe(500);
    expect((await a.request(`/api/uploads/${up.id}`)).status).toBe(200);
    expect((await a.request(`/api/uploads/${up.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await a.request(`/api/uploads/${up.id}`)).status).toBe(404);
  });

  it("answers 404 for another person's upload on every route", async () => {
    const owner = await signedIn(t.db, { username: "upowner" });
    const other = await signedIn(t.db, { username: "upother" });
    const up = await create(app(owner));
    const b = app(other);
    expect((await b.request(`/api/uploads/${up.id}`)).status).toBe(404);
    expect((await put(b, `/api/uploads/${up.id}/parts/1`, Buffer.from("abcd"))).status).toBe(404);
    expect((await put(b, `/api/uploads/${up.id}/thumbnail`, PNG, "image/png")).status).toBe(404);
    expect((await post(b, `/api/uploads/${up.id}/complete`)).status).toBe(404);
    expect((await b.request(`/api/uploads/${up.id}`, { method: "DELETE" })).status).toBe(404);
    const mine = await b.request("/api/uploads");
    expect(await mine.json()).toEqual([]);
  });
});
