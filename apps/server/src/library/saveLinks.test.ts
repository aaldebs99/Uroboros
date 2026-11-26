import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaveLink } from "@uroboros/contract";
import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";
import { sweepExpiredSaveLinks } from "./saveLinks.ts";

/**
 * Save links (docs/downloads.md#saving-a-file): the installed iPhone app opens Save in a window of
 * its own, which may not have the app's cookies, so it gets a short-lived link that needs none.
 */

const logger = pino({ level: "silent" });
const KEY = "Blender/Big Buck Bunny [bbb]/Big Buck Bunny [Best available].mp4";
const COPY_KEY = "exports/bbb-no-sponsors.mp4";
let testDb: TestDb;
let store: MediaStore;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;
let entryId: string;
let doneCopy: string;
let queuedCopy: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-save-")),
    layout: DEFAULT_LAYOUT,
  });
  const src = join(await mkdtemp(join(tmpdir(), "uroboros-save-src-")), "f");
  await writeFile(src, "0123456789");
  await store.put(KEY, src, "video/mp4");
  await store.put(COPY_KEY, src, "video/mp4");
  alice = await signedIn(testDb.db, { username: "salice" });
  bob = await signedIn(testDb.db, { username: "sbob" });
  carol = await signedIn(testDb.db, { username: "scarol" });
  const seeded = await seedEntry(testDb.db, alice.userId, {
    videoId: "bbb",
    title: "Big Buck Bunny",
    storageKey: KEY,
  });
  entryId = seeded.entryId;
  await shareWithCarol();
  const copy = { user_id: alice.userId, entry_id: entryId, rendition_id: seeded.renditionId };
  doneCopy = (
    await testDb.db
      .insertInto("exports")
      .values({
        ...copy,
        cuts: JSON.stringify([]),
        state: "done",
        storage_key: COPY_KEY,
        size_bytes: 10,
        finished_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  queuedCopy = (
    await testDb.db
      .insertInto("exports")
      .values({ ...copy, cuts: JSON.stringify([]) })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
});
afterAll(async () => {
  await testDb.close();
});

/** Alice shares the entry with Carol. */
async function shareWithCarol() {
  const share = await testDb.db
    .insertInto("shares")
    .values({ owner_id: alice.userId, entry_id: entryId, mode: "people" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await testDb.db
    .insertInto("share_people")
    .values({ share_id: share.id, user_id: carol.userId })
    .execute();
}

const make = () => createApp({ db: testDb.db, version: "t", logger, store }, { webDist: null });
/** The window Save opens: no session cookie, no CSRF header. */
const window = () => make();
const ask = (s: SignedIn, path: string) => asUser(make(), s).request(path, { method: "POST" });

async function linkFor(s: SignedIn, path: string): Promise<string> {
  const res = await ask(s, path);
  expect(res.status).toBe(201);
  return SaveLink.parse(await res.json()).url;
}
const tokenOf = (url: string) => url.split("/").pop() ?? "";
const hashOf = (token: string) => createHash("sha256").update(token).digest();

describe("POST /api/library/{id}/save-link", () => {
  it("saves the person's entry through a link that needs no cookie, ranges included", async () => {
    const res = await ask(alice, `/api/library/${entryId}/save-link`);
    expect(res.status).toBe(201);
    const link = SaveLink.parse(await res.json());
    expect(link.url).toMatch(/^\/api\/public\/saves\/[A-Za-z0-9_-]{43}$/);
    const left = new Date(link.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(59 * 60_000);
    expect(left).toBeLessThanOrEqual(60 * 60_000);
    const whole = await window().request(link.url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("Big Buck Bunny [Best available].mp4")}`,
    );
    expect(await whole.text()).toBe("0123456789");
    const part = await window().request(link.url, { headers: { range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("234");
  });

  it("works for a viewer the entry is shared with, and stops when the share does", async () => {
    const url = await linkFor(carol, `/api/library/${entryId}/save-link`);
    expect((await window().request(url)).status).toBe(200);
    await testDb.db.deleteFrom("shares").where("entry_id", "=", entryId).execute();
    try {
      expect((await window().request(url)).status).toBe(404);
    } finally {
      await shareWithCarol();
    }
  });

  it("gives no link for someone else's entry", async () => {
    expect((await ask(bob, `/api/library/${entryId}/save-link`)).status).toBe(404);
  });

  it("is refused without a session", async () => {
    const res = await window().request(`/api/library/${entryId}/save-link`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/public/saves/{token}", () => {
  it("stops working once the link expires", async () => {
    const url = await linkFor(alice, `/api/library/${entryId}/save-link`);
    await testDb.db
      .updateTable("save_links")
      .set({ expires_at: sql<Date>`now() - interval '1 second'` })
      .where("token_hash", "=", hashOf(tokenOf(url)))
      .execute();
    expect((await window().request(url)).status).toBe(404);
  });

  it("refuses a link nobody made", async () => {
    const made = randomBytes(32).toString("base64url");
    expect((await window().request(`/api/public/saves/${made}`)).status).toBe(404);
  });
});

describe("POST /api/exports/{id}/save-link", () => {
  it("saves a finished copy without a cookie", async () => {
    const url = await linkFor(alice, `/api/exports/${doneCopy}/save-link`);
    const res = await window().request(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      encodeURIComponent("Big Buck Bunny (no sponsors).mp4"),
    );
    expect(await res.text()).toBe("0123456789");
  });

  it("gives no link for a copy not finished, nor for someone else's", async () => {
    expect((await ask(alice, `/api/exports/${queuedCopy}/save-link`)).status).toBe(404);
    expect((await ask(bob, `/api/exports/${doneCopy}/save-link`)).status).toBe(404);
  });
});

describe("sweepExpiredSaveLinks", () => {
  it("deletes the links that expired, and keeps the rest", async () => {
    const kept = await linkFor(alice, `/api/library/${entryId}/save-link`);
    const gone = await linkFor(alice, `/api/library/${entryId}/save-link`);
    await testDb.db
      .updateTable("save_links")
      .set({ expires_at: sql<Date>`now() - interval '1 second'` })
      .where("token_hash", "=", hashOf(tokenOf(gone)))
      .execute();
    expect(await sweepExpiredSaveLinks(testDb.db)).toBeGreaterThanOrEqual(1);
    const left = await testDb.db.selectFrom("save_links").select("token_hash").execute();
    const hashes = left.map((r) => r.token_hash.toString("hex"));
    expect(hashes).toContain(hashOf(tokenOf(kept)).toString("hex"));
    expect(hashes).not.toContain(hashOf(tokenOf(gone)).toString("hex"));
  });
});
