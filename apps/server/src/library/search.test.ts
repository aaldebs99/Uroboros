import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryPage } from "@uroboros/contract";
import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { ApiError } from "../api/errors.ts";
import { createApp } from "../api/app.ts";
import { underSearchTimeout } from "./search.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;

/** Added `n` minutes into 2026: a larger `n` is newer. */
const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n));

/** Gives `mediaId` an English track whose caption runs are `runs`. */
async function captions(
  mediaId: string,
  runs: { text: string; start_s: number; line_at?: number[]; line_start?: number[] }[],
) {
  const sub = await testDb.db
    .insertInto("subtitles")
    .values({ media_id: mediaId, lang: "en", storage_key: `subs/${mediaId}.vtt` })
    .returning("id")
    .executeTakeFirstOrThrow();
  await testDb.db
    .insertInto("caption_segments")
    .values(
      runs.map((r, seq) => ({
        subtitle_id: sub.id,
        media_id: mediaId,
        seq,
        text: r.text,
        start_s: r.start_s,
        end_s: r.start_s + 4,
        line_at: r.line_at ?? [0],
        line_start: r.line_start ?? [r.start_s],
      })),
    )
    .execute();
}

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await signedIn(testDb.db, { username: "salice" });
  bob = await signedIn(testDb.db, { username: "sbob" });
  carol = await signedIn(testDb.db, { username: "scarol" });
  const add = (
    title: string,
    n: number,
    media: NonNullable<Parameters<typeof seedEntry>[2]>["media"] = {},
  ) => seedEntry(testDb.db, alice.userId, { title, media, addedAt: at(n) });
  await add("Dragons of the North", 1, { channel: "Nature" });
  await add("Cooking", 2, { channel: "Dragonfly Kitchen" });
  await add("Uploads", 3, { channel: null, uploader: "dragonrider" });
  await add("Walk", 4, {
    chapters: [
      { start: 0, end: 60, title: "Intro" },
      { start: 60, end: null, title: "The dragon's lair" },
    ],
  });
  await add("Talk", 5, { description: "We met a dragon at the fair" });
  await add("Unrelated", 6, { description: "nothing here" });
  await add("100% pure", 7);
  await add("1000 cuts", 8);
  await add("file_name", 9);
  await add("fileXname", 10);
  // Newer than "Dragons of the North", but its match is in a weaker place.
  await add("Later talk", 11, { description: "another dragon" });
  await seedEntry(testDb.db, bob.userId, { title: "Bob's dragon", addedAt: at(12) });
  // Spoken only: the captions hold the word.
  const { mediaId } = await add("Lecture", 13);
  await captions(mediaId, [
    { text: "and then the dragon", start_s: 30 },
    { text: "flew over the fair", start_s: 34 },
  ]);
  // A title match whose captions hold the word too.
  const lore = await seedEntry(testDb.db, carol.userId, { title: "Dragon lore", addedAt: at(14) });
  await captions(lore.mediaId, [
    { text: "first words", start_s: 2 },
    { text: "more about the dragon", start_s: 10, line_at: [0, 11], line_start: [10, 12] },
  ]);
});
afterAll(async () => {
  await testDb.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: testDb.db, version: "t", logger }, { webDist: null }), s);

async function page(s: SignedIn, query: string): Promise<LibraryPage> {
  const res = await app(s).request(`/api/library${query}`);
  expect(res.status).toBe(200);
  return LibraryPage.parse(await res.json());
}
const found = async (q: string, s = alice, more = "") =>
  (await page(s, `?q=${encodeURIComponent(q)}${more}`)).entries.map((e) => e.title);

describe("library search", () => {
  it("finds a word in a title, channel, uploader, chapter or description, best place first", async () => {
    expect(await found("dragon")).toEqual([
      "Dragons of the North",
      // Channel matches, the newer first: an uploader stands in for a missing channel.
      "Uploads",
      "Cooking",
      "Walk",
      // Descriptions, the newer first.
      "Later talk",
      "Talk",
      // Then what was said.
      "Lecture",
    ]);
  });

  it("needs every word within one run of caption lines", async () => {
    expect(await found("then dragon")).toEqual(["Lecture"]);
    // The words are in neighbouring runs, not one.
    expect(await found("dragon flew")).toEqual([]);
  });

  it("needs every word within one title, chapter or description", async () => {
    expect(await found("dragon fair")).toEqual(["Talk"]);
    expect(await found("DRAGON LAIR")).toEqual(["Walk"]);
    // "north" is in a title and "lair" in a chapter: no single place holds both.
    expect(await found("north lair")).toEqual([]);
    expect(await found("walk dragon")).toEqual([]);
  });

  it("matches a quoted phrase as written, and LIKE's wildcards literally", async () => {
    expect(await found('"the north"')).toEqual(["Dragons of the North"]);
    expect(await found('"north the"')).toEqual([]);
    expect(await found("100%")).toEqual(["100% pure"]);
    expect(await found("file_name")).toEqual(["file_name"]);
    // OR is a word now, not an operator.
    expect(await found("dragon OR talk")).toEqual([]);
  });

  it("pages through the ranked matches without gaps or repeats", async () => {
    const all = await found("dragon");
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const more: string = cursor === null ? "" : `&cursor=${cursor}`;
      const p = await page(alice, `?q=dragon&limit=2${more}`);
      seen.push(...p.entries.map((e) => e.title));
      cursor = p.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(all);
  });

  it("orders by another sort when asked, still keeping only the matches", async () => {
    expect(await found("dragon", alice, "&sort=title")).toEqual([
      "Cooking",
      "Dragons of the North",
      "Later talk",
      "Lecture",
      "Talk",
      "Uploads",
      "Walk",
    ]);
    expect(await found("dragon", alice, "&sort=added")).toEqual([
      "Lecture",
      "Later talk",
      "Talk",
      "Walk",
      "Uploads",
      "Cooking",
      "Dragons of the North",
    ]);
  });

  it("searches only the caller's own library", async () => {
    expect(await found("bob's")).toEqual([]);
    expect(await found("dragon", bob)).toEqual(["Bob's dragon"]);
  });

  it("refuses a search the indexes cannot answer, or one too long", async () => {
    for (const q of ["ab", "a b", "!!!", "x".repeat(201), "a1 b2 c3 d4 e5 f6 g7 h8 i9 abc"]) {
      const res = await app(alice).request(`/api/library?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(400);
    }
    // Nothing but spaces is no search at all.
    expect((await page(alice, "?q=%20%20")).entries).toHaveLength(12);
  });
});

describe("where a search matched", () => {
  it("shows a chapter, the description or the captions, with the time to play from", async () => {
    const p = await page(alice, "?q=dragon");
    const by = Object.fromEntries(p.entries.map((e) => [e.title, e.match]));
    // The tile shows a title or channel already.
    expect(by["Dragons of the North"]).toBeNull();
    expect(by["Cooking"]).toBeNull();
    expect(by["Walk"]).toEqual({
      in: "chapter",
      snippet: [
        { text: "The ", mark: false },
        { text: "dragon", mark: true },
        { text: "'s lair", mark: false },
      ],
      start: 60,
    });
    expect(by["Later talk"]).toEqual({
      in: "description",
      snippet: [
        { text: "another ", mark: false },
        { text: "dragon", mark: true },
      ],
      start: null,
    });
    expect(by["Lecture"]).toEqual({
      in: "captions",
      snippet: [
        { text: "and then the ", mark: false },
        { text: "dragon", mark: true },
      ],
      start: 30,
    });
  });

  it("shows the captions of a title match too, from the line that holds the words", async () => {
    const [lore] = (await page(carol, "?q=dragon")).entries;
    expect(lore?.match).toEqual({
      in: "captions",
      snippet: [
        { text: "more about the ", mark: false },
        { text: "dragon", mark: true },
      ],
      start: 12,
    });
  });

  it("says nothing of matches without a search", async () => {
    const res = await app(alice).request("/api/library?limit=1");
    const body = (await res.json()) as { entries: Record<string, unknown>[] };
    expect(body.entries[0]).not.toHaveProperty("match");
  });
});

describe("underSearchTimeout", () => {
  it("cuts a search that runs too long short with a 503", async () => {
    const slow = underSearchTimeout(testDb.db, (tx) => sql`SELECT pg_sleep(2)`.execute(tx), 50);
    await expect(slow).rejects.toMatchObject({ code: "unavailable" });
    await expect(slow).rejects.toBeInstanceOf(ApiError);
    const quick = await underSearchTimeout(testDb.db, (tx) =>
      sql<{ n: number }>`SELECT 1 AS n`.execute(tx),
    );
    expect(quick.rows).toEqual([{ n: 1 }]);
  });
});
