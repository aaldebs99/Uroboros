import { randomUUID } from "node:crypto";
import { LibraryPage } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { linkMatch } from "./linkMatch.ts";

describe("linkMatch", () => {
  it.each([
    "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    "https://youtube.com/watch?v=aqz-KE-bpKQ&t=42s&si=abc",
    "https://m.youtube.com/watch?feature=share&v=aqz-KE-bpKQ",
    "https://music.youtube.com/watch?v=aqz-KE-bpKQ&list=RDx",
    "https://youtu.be/aqz-KE-bpKQ?si=xyz",
    "https://www.youtube.com/shorts/aqz-KE-bpKQ",
    "https://www.youtube.com/live/aqz-KE-bpKQ?feature=share",
    "https://www.youtube.com/embed/aqz-KE-bpKQ",
  ])("reads the YouTube video id from %s", (link) => {
    expect(linkMatch(link)).toEqual({ kind: "youtube", videoId: "aqz-KE-bpKQ" });
  });

  it("treats a YouTube channel, playlist or bad id as a page", () => {
    for (const link of [
      "https://www.youtube.com/@BlenderOfficial",
      "https://www.youtube.com/playlist?list=PL1",
      "https://www.youtube.com/watch?v=short",
      "https://youtu.be/",
    ]) {
      expect(linkMatch(link).kind).toBe("pages");
    }
  });

  it("tries the page without its fragment, in either scheme, with or without www and a final slash", () => {
    const match = linkMatch("http://vimeo.com/76979871/#t=10");
    expect(match.kind).toBe("pages");
    const urls = match.kind === "pages" ? match.urls : [];
    expect(urls).toEqual(
      expect.arrayContaining([
        "http://vimeo.com/76979871/#t=10",
        "https://vimeo.com/76979871",
        "https://www.vimeo.com/76979871/",
        "http://www.vimeo.com/76979871",
      ]),
    );
    expect(urls.some((u) => u.includes("#"))).toBe(true);
    expect(urls.filter((u) => u.includes("#"))).toHaveLength(1);
  });

  it("keeps a query string intact", () => {
    const match = linkMatch("https://example.com/watch?id=7");
    expect(match.kind === "pages" ? match.urls : []).toContain("https://example.com/watch?id=7");
    expect(match.kind === "pages" ? match.urls : []).toContain("https://example.com/watch/?id=7");
  });
});

const logger = pino({ level: "silent" });
let testDb: TestDb;
let alice: SignedIn;
let bob: SignedIn;

async function add(user: SignedIn, media: Record<string, unknown>): Promise<string> {
  const p = await seededDefault(testDb.db);
  const m = await testDb.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: randomUUID().slice(0, 11), title: "t", ...media })
    .onConflict((oc) => oc.columns(["extractor", "video_id"]).doUpdateSet({ title: "t" }))
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await testDb.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: p.id,
      profile_revision: p.revision,
      storage_key: `k/${randomUUID()}`,
      size_bytes: 1,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const e = await testDb.db
    .insertInto("library_entries")
    .values({ user_id: user.userId, media_id: m.id, rendition_id: r.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  return e.id;
}

const app = (s: SignedIn) =>
  asUser(createApp({ db: testDb.db, version: "t", logger }, { webDist: null }), s);

async function page(s: SignedIn, query: string): Promise<LibraryPage> {
  const res = await app(s).request(`/api/library${query}`);
  expect(res.status).toBe(200);
  return LibraryPage.parse(await res.json());
}

const byUrl = async (s: SignedIn, link: string) =>
  (await page(s, `?url=${encodeURIComponent(link)}`)).entries.map((e) => e.id);

let bunny: string;
let vimeo: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await signedIn(testDb.db, { username: "lalice" });
  bob = await signedIn(testDb.db, { username: "lbob" });
  bunny = await add(alice, {
    video_id: "aqz-KE-bpKQ",
    title: "Big Buck Bunny",
    webpage_url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  });
  vimeo = await add(alice, {
    extractor: "vimeo",
    video_id: "76979871",
    title: "The New Vimeo Player",
    webpage_url: "https://vimeo.com/76979871",
  });
  for (let i = 0; i < 7; i++) await add(alice, { title: `Filler ${String(i)}` });
});
afterAll(async () => {
  await testDb.close();
});

describe("GET /api/library?url=", () => {
  it("finds a YouTube video from any of its link shapes", async () => {
    for (const link of [
      "https://youtu.be/aqz-KE-bpKQ?si=1",
      "https://www.youtube.com/shorts/aqz-KE-bpKQ",
      "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=3",
    ]) {
      expect(await byUrl(alice, link)).toEqual([bunny]);
    }
  });

  it("finds another site's video by its page, with or without www, a final slash or a fragment", async () => {
    for (const link of [
      "https://vimeo.com/76979871",
      "https://www.vimeo.com/76979871/",
      "http://vimeo.com/76979871#t=5",
    ]) {
      expect(await byUrl(alice, link)).toEqual([vimeo]);
    }
  });

  it("finds nothing for a video the caller doesn't have, even when someone else does", async () => {
    expect(await byUrl(alice, "https://youtu.be/aaaaaaaaaaa")).toEqual([]);
    expect(await byUrl(bob, "https://youtu.be/aqz-KE-bpKQ")).toEqual([]);
  });

  it("refuses something that isn't an http(s) link (400)", async () => {
    expect((await app(alice).request("/api/library?url=ftp%3A%2F%2Fx")).status).toBe(400);
    expect((await app(alice).request("/api/library?url=bunny")).status).toBe(400);
  });
});

describe("GET /api/library?limit=", () => {
  it("returns that many, and its cursor pages on without gaps", async () => {
    const first = await page(alice, "?limit=4");
    expect(first.entries).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(
      alice,
      `?limit=4&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
    );
    const third = await page(
      alice,
      `?limit=4&cursor=${encodeURIComponent(second.nextCursor ?? "")}`,
    );
    const ids = [...first.entries, ...second.entries, ...third.entries].map((e) => e.id);
    expect(new Set(ids).size).toBe(9);
    expect(third.nextCursor).toBeNull();
  });

  it("refuses a limit outside 1–60 (400)", async () => {
    for (const limit of ["0", "61", "two", "1.5"]) {
      expect((await app(alice).request(`/api/library?limit=${limit}`)).status).toBe(400);
    }
  });
});
