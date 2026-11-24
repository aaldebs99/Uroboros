import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicItem, PublicShare } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let alice: SignedIn;
let film: SeededEntry;
let other: SeededEntry;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-pub-")),
    layout: DEFAULT_LAYOUT,
  });
  const src = join(await mkdtemp(join(tmpdir(), "uroboros-pub-src-")), "f");
  await writeFile(src, "0123456789");
  await store.put("film.mp4", src, "video/mp4");
  alice = await signedIn(t.db, { username: "pubalice" });
  film = await seedEntry(t.db, alice.userId, { title: "Public film", storageKey: "film.mp4" });
  other = await seedEntry(t.db, alice.userId, { title: "Private film" });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

/** No session at all: a stranger's browser. */
const anon = (path: string, init?: RequestInit) =>
  createApp(
    {
      db: t.db,
      version: "t",
      logger,
      downloads: h.ctx,
      store,
    },
    { webDist: null },
  ).request(path, init);

let n = 0;
async function link(target: { entry_id: string } | { playlist_id: string }, allowDownload = false) {
  const code = `code${String(++n)}xxxxxxxxxxxxxxxx`.slice(0, 22);
  // One link per thing: this one replaces any earlier test's.
  const column = "entry_id" in target ? "entry_id" : "playlist_id";
  const value = "entry_id" in target ? target.entry_id : target.playlist_id;
  await t.db.deleteFrom("shares").where("mode", "=", "link").where(column, "=", value).execute();
  await t.db
    .insertInto("shares")
    .values({
      owner_id: alice.userId,
      mode: "link",
      code,
      allow_download: allowDownload,
      ...target,
    })
    .execute();
  return code;
}

describe("public links", () => {
  it("lists a video's one item and streams it to anyone", async () => {
    const code = await link({ entry_id: film.entryId });
    const res = await anon(`/api/public/s/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const share = PublicShare.parse(await res.json());
    expect(share).toMatchObject({ kind: "entry", title: "Public film", allowDownload: false });
    expect(share.items.map((i) => i.id)).toEqual([film.entryId]);
    const item = PublicItem.parse(
      await (await anon(`/api/public/s/${code}/items/${film.entryId}`)).json(),
    );
    expect(item.streamUrl).toBe(`/api/public/s/${code}/items/${film.entryId}/stream`);
    expect(item.fileUrl).toBeNull();
    const stream = await anon(item.streamUrl);
    expect(stream.status).toBe(200);
    expect(await stream.text()).toBe("0123456789");
    expect((await anon(`/api/public/s/${code}/items/${film.entryId}/file`)).status).toBe(404);
  });

  it("offers the file only when downloads are allowed", async () => {
    const code = await link({ entry_id: film.entryId }, true);
    const item = PublicItem.parse(
      await (await anon(`/api/public/s/${code}/items/${film.entryId}`)).json(),
    );
    expect(item.fileUrl).toBe(`/api/public/s/${code}/items/${film.entryId}/file`);
    const file = await anon(item.fileUrl ?? "");
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment;/);
    await t.db.deleteFrom("shares").where("code", "=", code).execute();
  });

  it("a playlist link serves the playlist in order, and nothing else", async () => {
    const p = await t.db
      .insertInto("playlists")
      .values({ user_id: alice.userId, name: "Two films" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const third = await seedEntry(t.db, alice.userId, { title: "Third" });
    for (const [position, entry_id] of [third.entryId, film.entryId].entries()) {
      await t.db
        .insertInto("playlist_items")
        .values({ playlist_id: p.id, user_id: alice.userId, entry_id, position })
        .execute();
    }
    const code = await link({ playlist_id: p.id });
    const share = PublicShare.parse(await (await anon(`/api/public/s/${code}`)).json());
    expect(share).toMatchObject({ kind: "playlist", title: "Two films" });
    expect(share.items.map((i) => i.title)).toEqual(["Third", "Public film"]);
    expect((await anon(`/api/public/s/${code}/items/${other.entryId}`)).status).toBe(404);
    expect((await anon(`/api/public/s/${code}/items/${other.entryId}/stream`)).status).toBe(404);
  });

  it("every dead link answers the same", async () => {
    const expiredCode = await link({ entry_id: film.entryId });
    await t.db
      .updateTable("shares")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("code", "=", expiredCode)
      .execute();
    const dave = await signedIn(t.db, { username: "pubdave" });
    const daves = await seedEntry(t.db, dave.userId);
    const disabledCode = await link({ entry_id: film.entryId });
    await t.db
      .updateTable("shares")
      .set({ owner_id: dave.userId, entry_id: daves.entryId })
      .where("code", "=", disabledCode)
      .execute();
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", dave.userId)
      .execute();
    const bodies = [];
    for (const code of ["neverexisted0000000000", expiredCode, disabledCode]) {
      const res = await anon(`/api/public/s/${code}`);
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain("this link doesn't work any more");
  });

  it("public playback URLs stay under the code", async () => {
    const code = await link({ entry_id: film.entryId });
    const item = PublicItem.parse(
      await (await anon(`/api/public/s/${code}/items/${film.entryId}`)).json(),
    );
    expect(item.playbackUrl).toBe(`/api/public/s/${code}/items/${film.entryId}/playback`);
    expect(item).toMatchObject({ videoCodecs: null, width: null, qualities: [] });
    expect(item.skipSegments).toEqual([]);
  });

  it("a public item carries the SponsorBlock segments its player skips", async () => {
    const segments = [{ start: 49.04, end: 69, category: "sponsor" }];
    await t.db
      .updateTable("renditions")
      .set({ skip_segments: JSON.stringify(segments) })
      .where("id", "=", film.renditionId)
      .execute();
    const code = await link({ entry_id: film.entryId });
    const item = PublicItem.parse(
      await (await anon(`/api/public/s/${code}/items/${film.entryId}`)).json(),
    );
    expect(item.skipSegments).toEqual(segments);
  });
});
