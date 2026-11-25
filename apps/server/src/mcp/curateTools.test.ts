import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryItem, PlaylistDetail } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { callTool, mcpPost, mcpToken } from "../../test/mcp.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { createApp } from "../api/app.ts";
import { playlistEntryIds } from "../playlists/listing.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let app: OpenAPIHono;
let owner: string;
let secret: string;
let a: SeededEntry;
let b: SeededEntry;

beforeAll(async () => {
  testDb = await TestDb.create();
  app = createApp({ db: testDb.db, version: "t", logger }, { webDist: null, mcpEnabled: true });
  owner = await insertUser(testDb.db, { username: "mcpcurate" });
  secret = await mcpToken(testDb.db, owner);
  a = await seedEntry(testDb.db, owner, { title: "First" });
  b = await seedEntry(testDb.db, owner, { title: "Second" });
});
afterAll(async () => {
  await testDb.close();
});

const ok = async (name: string, args: Record<string, unknown>) => {
  const r = await callTool(app, secret, name, args);
  // the tool's error text, when it fails, says why
  expect([name, r.isError === true ? r.content[0]?.text : "ok"]).toEqual([name, "ok"]);
  return r.structuredContent;
};

describe("the MCP curating tools", () => {
  it("make a playlist, add to it and take from it", async () => {
    const made = PlaylistDetail.parse(
      await ok("create_playlist", { name: "Watch later", entryIds: [a.entryId] }),
    );
    expect(made).toMatchObject({ name: "Watch later", kind: "manual", count: 1 });
    const added = PlaylistDetail.parse(
      await ok("add_to_playlist", { playlistId: made.id, entryIds: [b.entryId, a.entryId] }),
    );
    expect(added.count).toBe(2);
    expect(await playlistEntryIds(testDb.db, owner, { kind: "manual", id: made.id })).toEqual([
      a.entryId,
      b.entryId,
    ]);
    const removed = PlaylistDetail.parse(
      await ok("remove_from_playlist", { playlistId: made.id, entryId: a.entryId }),
    );
    expect(removed.count).toBe(1);
    expect(await playlistEntryIds(testDb.db, owner, { kind: "manual", id: made.id })).toEqual([
      b.entryId,
    ]);
  });

  it("tag a video, mark it watched and keep it, in one call", async () => {
    const item = LibraryItem.parse(
      await ok("update_entry", {
        entryId: a.entryId,
        tags: ["Rust", "talks", "rust"],
        watched: true,
        kept: true,
      }),
    );
    expect(item.tags).toEqual(["rust", "talks"]);
    expect(item.kept).toBe(true);
    expect(item.progress?.watched).toBe(true);
    const unwatched = LibraryItem.parse(
      await ok("update_entry", { entryId: a.entryId, watched: false }),
    );
    expect(unwatched.progress?.watched).toBe(false);
    expect(unwatched.tags).toEqual(["rust", "talks"]);
  });

  it("refuse an update that changes nothing", async () => {
    const res = await mcpPost(app, secret, "tools/call", {
      name: "update_entry",
      arguments: { entryId: a.entryId },
    });
    const body = await res.text();
    expect(body).toContain("nothing to change");
  });

  it("never touch someone else's video or playlist", async () => {
    const stranger = await insertUser(testDb.db, { username: "mcpcurate2" });
    const theirs = await seedEntry(testDb.db, stranger, { title: "Theirs" });
    const tag = await callTool(app, secret, "update_entry", {
      entryId: theirs.entryId,
      kept: true,
    });
    expect(tag.isError).toBe(true);
    expect(tag.content[0]?.text).toBe("not_found: no such library entry");
    const add = await callTool(app, secret, "create_playlist", {
      name: "Sneaky",
      entryIds: [theirs.entryId],
    });
    expect(add.isError).toBe(true);
  });

  it("let a share's recipient mark it watched, but never change its tags or Keep", async () => {
    const sharer = await insertUser(testDb.db, { username: "mcpcurate3" });
    const shared = await seedEntry(testDb.db, sharer, { title: "Shared" });
    await testDb.db
      .insertInto("entry_tags")
      .values({ entry_id: shared.entryId, tag: "theirs" })
      .execute();
    const share = await testDb.db
      .insertInto("shares")
      .values({ owner_id: sharer, entry_id: shared.entryId, mode: "people" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await testDb.db
      .insertInto("share_people")
      .values({ share_id: share.id, user_id: owner })
      .execute();

    const watched = LibraryItem.parse(
      await ok("update_entry", { entryId: shared.entryId, watched: true }),
    );
    expect(watched.progress?.watched).toBe(true);
    for (const change of [{ tags: ["mine"] }, { kept: true }, { tags: [], watched: false }]) {
      const r = await callTool(app, secret, "update_entry", { entryId: shared.entryId, ...change });
      expect([change, r.isError]).toEqual([change, true]);
    }
    const tags = await testDb.db
      .selectFrom("entry_tags")
      .select("tag")
      .where("entry_id", "=", shared.entryId)
      .execute();
    expect(tags.map((t) => t.tag)).toEqual(["theirs"]);
    const row = await testDb.db
      .selectFrom("library_entries")
      .select("kept")
      .where("id", "=", shared.entryId)
      .executeTakeFirstOrThrow();
    expect(row.kept).toBe(false);
  });

  it("never add to or take from someone else's playlist", async () => {
    const stranger = await insertUser(testDb.db, { username: "mcpcurate4" });
    const theirs = await seedEntry(testDb.db, stranger, { title: "Their list's" });
    const list = await testDb.db
      .insertInto("playlists")
      .values({ user_id: stranger, name: "Theirs" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await testDb.db
      .insertInto("playlist_items")
      .values({ playlist_id: list.id, user_id: stranger, entry_id: theirs.entryId, position: 0 })
      .execute();
    const add = await callTool(app, secret, "add_to_playlist", {
      playlistId: list.id,
      entryIds: [a.entryId],
    });
    expect(add.isError).toBe(true);
    const take = await callTool(app, secret, "remove_from_playlist", {
      playlistId: list.id,
      entryId: theirs.entryId,
    });
    expect(take.isError).toBe(true);
    expect(await playlistEntryIds(testDb.db, stranger, { kind: "manual", id: list.id })).toEqual([
      theirs.entryId,
    ]);
  });
});
