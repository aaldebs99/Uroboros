import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  ChannelSummary,
  LibraryItem,
  LibraryPage,
  PlaylistDetail,
  PlaylistSummary,
  Transcript,
} from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { callTool, mcpToken } from "../../test/mcp.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { createApp } from "../api/app.ts";
import { appendItems, createPlaylist } from "../playlists/store.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let app: OpenAPIHono;
let owner: string;
let secret: string;
let talk: SeededEntry;

beforeAll(async () => {
  testDb = await TestDb.create();
  app = createApp({ db: testDb.db, version: "t", logger }, { webDist: null, mcpEnabled: true });
  owner = await insertUser(testDb.db, { username: "mcplib" });
  secret = await mcpToken(testDb.db, owner, { readOnly: true });
  talk = await seedEntry(testDb.db, owner, {
    title: "Ownership in Rust",
    media: { channel: "Systems Weekly" },
  });
  await seedEntry(testDb.db, owner, { title: "Sourdough basics", media: { channel: "Bakery" } });
  // The talk has a picture; the sourdough, like every seeded file, is sound only.
  await testDb.db
    .updateTable("renditions")
    .set({ video_codec: "h264" })
    .where("id", "=", talk.renditionId)
    .execute();
  const sub = await testDb.db
    .insertInto("subtitles")
    .values({
      media_id: talk.mediaId,
      lang: "en",
      storage_key: `subs/${talk.mediaId}.vtt`,
      indexed_at: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await testDb.db
    .insertInto("caption_segments")
    .values({
      subtitle_id: sub.id,
      media_id: talk.mediaId,
      seq: 0,
      text: "welcome back today the borrow checker explained",
      start_s: 40,
      end_s: 48,
      line_at: [0, 18],
      line_start: [40, 42],
    })
    .execute();
});
afterAll(async () => {
  await testDb.close();
});

const structured = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await callTool(app, secret, name, args);
  expect([name, r.isError ?? false]).toEqual([name, false]);
  return r.structuredContent;
};

describe("the MCP library tools", () => {
  it("search the library and say where in the captions a match is", async () => {
    const page = LibraryPage.parse(await structured("search_library", { q: "borrow checker" }));
    expect(page.entries.map((e) => e.title)).toEqual(["Ownership in Rust"]);
    expect(page.entries[0]?.match).toMatchObject({ in: "captions", start: 42 });
  });

  it("list the library by channel without a search", async () => {
    const page = LibraryPage.parse(await structured("search_library", { sort: "title" }));
    expect(page.entries.map((e) => e.title)).toEqual(["Ownership in Rust", "Sourdough basics"]);
    const channels = ChannelSummary.array().parse((await structured("list_channels"))?.channels);
    expect(channels.map((c) => c.name).sort()).toEqual(["Bakery", "Systems Weekly"]);
  });

  it("list the audio alone, or the videos alone", async () => {
    const audio = LibraryPage.parse(await structured("search_library", { kind: "audio" }));
    expect(audio.entries.map((e) => e.title)).toEqual(["Sourdough basics"]);
    const video = LibraryPage.parse(await structured("search_library", { kind: "video" }));
    expect(video.entries.map((e) => e.title)).toEqual(["Ownership in Rust"]);
  });

  it("read one video's details and transcript", async () => {
    const item = LibraryItem.parse(await structured("get_entry", { entryId: talk.entryId }));
    expect(item.title).toBe("Ownership in Rust");
    const t = Transcript.parse(await structured("read_transcript", { entryId: talk.entryId }));
    expect(t.lines).toEqual([
      { start: 40, text: "welcome back today" },
      { start: 42, text: "the borrow checker explained" },
    ]);
  });

  it("list playlists and read one in its order", async () => {
    const pl = await createPlaylist(testDb.db, owner, { name: "Learning" });
    await appendItems(testDb.db, owner, pl.id, [talk.entryId]);
    const listed = PlaylistSummary.array().parse((await structured("list_playlists"))?.playlists);
    expect(listed.map((p) => p.name)).toEqual(["Learning"]);
    const got = (await structured("get_playlist", { playlistId: pl.id })) ?? {};
    expect(PlaylistDetail.parse(got.playlist).name).toBe("Learning");
    expect(LibraryPage.parse(got.page).entries.map((e) => e.id)).toEqual([talk.entryId]);
  });

  it("answer a stranger's video as not found, as a tool error", async () => {
    const stranger = await insertUser(testDb.db, { username: "mcplib2" });
    const theirs = await seedEntry(testDb.db, stranger, { title: "Private" });
    const r = await callTool(app, secret, "get_entry", { entryId: theirs.entryId });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe("not_found: no such library entry");
  });
});
