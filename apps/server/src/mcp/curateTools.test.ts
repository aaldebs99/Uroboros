import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryItem, PlaylistDetail } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { callTool, mcpPost, mcpToken, setMcp } from "../../test/mcp.ts";
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
  app = createApp({ db: testDb.db, version: "t", logger }, { webDist: null });
  owner = await insertUser(testDb.db, { username: "mcpcurate" });
  secret = await mcpToken(testDb.db, owner);
  await setMcp(testDb.db, true);
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
});
