import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  ChannelSummary,
  LibraryPage,
  PlaylistSummary,
  type LibraryEntry,
} from "@uroboros/contract";
import { sql } from "kysely";
import { pino } from "pino";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let alice: SignedIn;
let bob: SignedIn;
let sourceId: string;
const CHANNELS = ["Blender", "Kurzgesagt", "NASA"];

async function add(
  user: SignedIn,
  i: number,
  over: Record<string, unknown> = {},
): Promise<{ entryId: string; mediaId: string }> {
  const p = await seededDefault(testDb.db);
  const channel = CHANNELS[i % 3] ?? "Blender";
  const media = await testDb.db
    .insertInto("media")
    .values({
      extractor: "youtube",
      video_id: `v${String(i)}-${randomUUID().slice(0, 6)}`,
      title: `Video ${String(i)}`,
      channel,
      channel_id: `UC-${channel}`,
      description: i === 7 ? "a story about a dragon" : "plain",
      upload_date: `2020${String((i % 12) + 1).padStart(2, "0")}01`,
      duration: i * 10,
      ...over,
    })
    .returning(["id", "video_id"])
    .executeTakeFirstOrThrow();
  const r = await testDb.db
    .insertInto("renditions")
    .values({
      media_id: media.id,
      profile_id: p.id,
      profile_revision: p.revision,
      storage_key: `k/${randomUUID()}`,
      size_bytes: 1,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const e = await testDb.db
    .insertInto("library_entries")
    .values({
      user_id: user.userId,
      media_id: media.id,
      rendition_id: r.id,
      added_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { entryId: e.id, mediaId: media.id };
}

let bunny: { entryId: string; mediaId: string };

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await signedIn(testDb.db, { username: "qalice" });
  bob = await signedIn(testDb.db, { username: "qbob" });
  const made: { entryId: string; mediaId: string }[] = [];
  for (let i = 0; i < 130; i++) made.push(await add(alice, i));
  bunny = await add(alice, 500, {
    title: "Big Buck Bunny",
    channel: "Blender",
    channel_id: "UC-Blender",
  });
  for (const m of made.slice(0, 5))
    await testDb.db
      .insertInto("entry_tags")
      .values({ entry_id: m.entryId, tag: "music" })
      .execute();
  await testDb.db
    .insertInto("watch_progress")
    .values({
      user_id: alice.userId,
      media_id: made[0]?.mediaId ?? "",
      position_s: 95,
      duration_s: 100,
      watched: true,
    })
    .execute();
  await testDb.db
    .insertInto("watch_progress")
    .values({
      user_id: bob.userId,
      media_id: made[1]?.mediaId ?? "",
      position_s: 99,
      duration_s: 100,
      watched: true,
    })
    .execute();
  const bobOwn = await add(bob, 900, { title: "Bob's secret" });
  await testDb.db
    .insertInto("entry_tags")
    .values({ entry_id: bobOwn.entryId, tag: "secret" })
    .execute();
  const s = await testDb.db
    .insertInto("sources")
    .values({
      extractor: "youtubetab",
      source_id: "PLx",
      kind: "playlist",
      title: "Mix",
      url: "https://x.example/p",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  sourceId = s.id;
  await testDb.db
    .insertInto("user_sources")
    .values({ user_id: alice.userId, source_id: s.id })
    .execute();
  const ids = await testDb.db
    .selectFrom("media")
    .select("video_id")
    .where("id", "in", [made[9]?.mediaId ?? "", made[3]?.mediaId ?? ""])
    .execute();
  const [nine, three] = [made[9], made[3]];
  const vid = async (m: { mediaId: string } | undefined) =>
    (
      await testDb.db
        .selectFrom("media")
        .select("video_id")
        .where("id", "=", m?.mediaId ?? "")
        .executeTakeFirstOrThrow()
    ).video_id;
  expect(ids).toHaveLength(2);
  await testDb.db
    .insertInto("source_items")
    .values([
      { source_id: s.id, extractor: "youtube", video_id: await vid(nine), position: 0 },
      { source_id: s.id, extractor: "youtube", video_id: await vid(three), position: 1 },
    ])
    .execute();
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

const titles = (entries: LibraryEntry[]) => entries.map((e) => e.title);

describe("GET /api/library", () => {
  it("pages 60 at a time without duplicates or gaps, even when entries are added between pages", async () => {
    const first = await page(alice, "");
    expect(first.entries).toHaveLength(60);
    await add(alice, 1000, { title: "Added later" });
    const seen = new Set(first.entries.map((e) => e.id));
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const next = await page(alice, `?cursor=${encodeURIComponent(cursor)}`);
      for (const e of next.entries) {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
      }
      cursor = next.nextCursor;
    }
    expect(seen.size).toBe(131);
  });

  it("pages through entries added in one transaction (same timestamp) without losing any", async () => {
    const carol = await signedIn(testDb.db, { username: "qcarol" });
    const p = await seededDefault(testDb.db);
    await testDb.db.transaction().execute(async (tx) => {
      for (let i = 0; i < 75; i++) {
        const m = await tx
          .insertInto("media")
          .values({
            extractor: "youtube",
            video_id: `tx-${String(i)}-${randomUUID().slice(0, 6)}`,
            title: `T${String(i)}`,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const r = await tx
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
        await tx
          .insertInto("library_entries")
          .values({
            user_id: carol.userId,
            media_id: m.id,
            rendition_id: r.id,
            added_at: new Date("2026-01-01T00:00:00.123456Z"),
          })
          .execute();
      }
      await sql`UPDATE library_entries SET added_at = '2026-01-01T00:00:00.123456Z' WHERE user_id = ${carol.userId}`.execute(
        tx,
      );
    });
    const seen = new Set<string>();
    let cursor: string | null = "";
    while (cursor !== null) {
      const next: LibraryPage = await page(
        carol,
        cursor === "" ? "" : `?cursor=${encodeURIComponent(cursor)}`,
      );
      for (const e of next.entries) seen.add(e.id);
      cursor = next.nextCursor;
    }
    expect(seen.size).toBe(75);
  });

  it("refuses a hand-made cursor whose id is not a uuid or whose key is the wrong type (400)", async () => {
    const bad = (key: unknown, id: string) =>
      Buffer.from(JSON.stringify([key, id])).toString("base64url");
    expect(
      (await app(alice).request(`/api/library?cursor=${bad("x", "-".repeat(36))}`)).status,
    ).toBe(400);
    expect(
      (await app(alice).request(`/api/library?cursor=${bad("not a date", randomUUID())}`)).status,
    ).toBe(400);
  });

  it("finds by title, channel and description, and refuses what it cannot search", async () => {
    expect(titles((await page(alice, "?q=bunny")).entries)).toEqual(["Big Buck Bunny"]);
    expect((await page(alice, "?q=dragon")).entries.map((e) => e.title)).toEqual(["Video 7"]);
    expect((await page(alice, "?q=kurzgesagt")).entries.length).toBeGreaterThan(40);
    expect(titles((await page(alice, "?q=%22big%20buck%22")).entries)).toEqual(["Big Buck Bunny"]);
    // OR and -word are words now: nothing holds "bunny", "or" and "dragon" together.
    expect((await page(alice, "?q=bunny%20OR%20dragon")).entries).toEqual([]);
    expect((await page(alice, "?q=-bunny")).entries).toEqual([]);
    for (const q of ["!!!", "x".repeat(300)]) {
      expect((await app(alice).request(`/api/library?q=${encodeURIComponent(q)}`)).status).toBe(
        400,
      );
    }
  });

  it("filters by channel, tag and watched, alone and together", async () => {
    const channels = z
      .array(ChannelSummary)
      .parse(await (await app(alice).request("/api/library/channels")).json());
    const nasa = channels.find((c) => c.name === "NASA");
    expect(nasa?.count).toBe(43);
    const byChannel = await page(alice, `?channel=${encodeURIComponent(nasa?.key ?? "")}`);
    expect(byChannel.entries.every((e) => e.channel === "NASA")).toBe(true);
    expect((await page(alice, "?tag=music")).entries).toHaveLength(5);
    expect(titles((await page(alice, "?watched=true")).entries)).toEqual(["Video 0"]);
    expect(titles((await page(alice, "?tag=music&watched=true")).entries)).toEqual(["Video 0"]);
    expect((await page(alice, "?tag=Music")).entries).toHaveLength(5);
  });

  it("sorts by title, duration and upload date", async () => {
    expect(titles((await page(alice, "?sort=title")).entries).slice(0, 2)).toEqual([
      "Added later",
      "Big Buck Bunny",
    ]);
    expect((await page(alice, "?sort=duration")).entries[0]?.duration).toBe(10000);
    const uploaded = (await page(alice, "?sort=uploaded")).entries.map((e) => e.uploadDate ?? "");
    expect([...uploaded].sort().reverse()).toEqual(uploaded);
  });

  it("lists a playlist in its order, and only for whoever queued it", async () => {
    expect(titles((await page(alice, `?source=${sourceId}`)).entries)).toEqual([
      "Video 9",
      "Video 3",
    ]);
    expect((await app(alice).request("/api/library?sort=position")).status).toBe(400);
    expect((await app(bob).request(`/api/library?source=${sourceId}`)).status).toBe(404);
    const playlists = z
      .array(PlaylistSummary)
      .parse(await (await app(alice).request("/api/playlists")).json());
    expect(playlists).toEqual([
      expect.objectContaining({ id: sourceId, kind: "youtube", name: "Mix", count: 2 }),
    ]);
    expect(
      z.array(PlaylistSummary).parse(await (await app(bob).request("/api/playlists")).json()),
    ).toEqual([]);
  });

  it("never shows another person's tags, progress or entries", async () => {
    const all = (await page(alice, "?tag=music")).entries;
    expect(all.find((e) => e.title === "Video 1")?.progress).toBeNull();
    expect(all.find((e) => e.title === "Video 0")?.progress).toMatchObject({ watched: true });
    expect(all.find((e) => e.title === "Video 0")?.tags).toEqual(["music"]);
    expect((await page(alice, "?tag=secret")).entries).toEqual([]);
    expect((await page(alice, "?q=secret")).entries).toEqual([]);
    expect(
      z
        .array(ChannelSummary)
        .parse(await (await app(bob).request("/api/library/channels")).json())
        .map((c) => c.count),
    ).toEqual([1]);
  });

  it("refuses a bad cursor or channel key (400)", async () => {
    expect((await app(alice).request("/api/library?cursor=garbage")).status).toBe(400);
    expect((await app(alice).request("/api/library?channel=garbage")).status).toBe(400);
  });

  it("names the site where a video has no channel or uploader, and links no channel page", async () => {
    const dave = await signedIn(testDb.db, { username: "qdave" });
    const none = { channel: null, channel_id: null, uploader: null };
    await add(dave, 1, { ...none, extractor: "vimeo", webpage_url: "https://vimeo.com/1" });
    await add(dave, 2, {
      ...none,
      extractor: "generic",
      webpage_url: "https://www.example.com/a.mp4",
    });
    await add(dave, 3, { channel: null, channel_id: null, uploader: "Someone" });
    const entries = (await page(dave, "?sort=title&order=asc")).entries;
    expect(entries.map((e) => [e.title, e.channel, e.channelKey === null])).toEqual([
      ["Video 1", "Vimeo", true],
      ["Video 2", "example.com", true],
      ["Video 3", "Someone", false],
    ]);
  });

  it("keeps the bunny reachable by its entry id", () => {
    expect(bunny.entryId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
