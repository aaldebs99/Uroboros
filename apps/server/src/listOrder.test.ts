import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../test/auth.ts";
import { seededDefault } from "../test/downloads.ts";
import { seedEntry } from "../test/library.ts";
import { TestDb } from "../test/testDb.ts";
import { downloadRows } from "./downloads/serialize.ts";
import { listPlaylists } from "./playlists/listing.ts";
import { listMyShares } from "./sharing/manage.ts";
import { listUploads } from "./uploads/store.ts";

/**
 * Rows written together share a timestamp (one transaction, or the same millisecond), so a list
 * ordered by time alone comes back in whatever order Postgres finds them, and may change between
 * two reads. Each list here breaks the tie on the row's id.
 */

let t: TestDb;

beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

const AT = new Date("2026-11-01T12:00:00Z");
const N = 6;
const desc = (ids: string[]) => [...ids].sort().reverse();
const asc = (ids: string[]) => [...ids].sort();
let n = 0;
const user = () => signedIn(t.db, { username: `order${String(++n)}` });

describe("lists of rows with the same timestamp", () => {
  it("lists downloads in one order, newest first then by id", async () => {
    const u = await user();
    const p = await seededDefault(t.db);
    const rows = await t.db
      .insertInto("downloads")
      .values(
        Array.from({ length: N }, () => {
          const videoId = `o-${randomUUID()}`;
          return {
            user_id: u.userId,
            profile_id: p.id,
            profile_revision: p.revision,
            args: JSON.stringify({}),
            extractor: "youtube",
            video_id: videoId,
            url: `https://youtu.be/${videoId}`,
            fetch_key: `youtube|${videoId}`,
            state: "done" as const,
            created_at: AT,
          };
        }),
      )
      .returning("id")
      .execute();
    const listed = await downloadRows(t.db, { userId: u.userId });
    expect(listed.map((r) => r.id)).toEqual(desc(rows.map((r) => r.id)));
  });

  it("lists manual playlists in one order, last changed first then by id", async () => {
    const u = await user();
    const rows = await t.db
      .insertInto("playlists")
      .values(
        Array.from({ length: N }, (_, i) => ({
          user_id: u.userId,
          name: `List ${String(i)}`,
          updated_at: AT,
        })),
      )
      .returning("id")
      .execute();
    const listed = await listPlaylists(t.db, u.userId);
    expect(listed.map((p) => p.id)).toEqual(desc(rows.map((r) => r.id)));
  });

  it("lists YouTube playlists in one order, last queued first then by id", async () => {
    const u = await user();
    const ids: string[] = [];
    for (let i = 0; i < N; i++) {
      const entry = await seedEntry(t.db, u.userId);
      const media = await t.db
        .selectFrom("media")
        .select("video_id")
        .where("id", "=", entry.mediaId)
        .executeTakeFirstOrThrow();
      const source = await t.db
        .insertInto("sources")
        .values({
          extractor: "youtube",
          source_id: `PL-${randomUUID()}`,
          kind: "playlist",
          url: `https://www.youtube.com/playlist?list=${String(i)}`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await t.db
        .insertInto("source_items")
        .values({
          source_id: source.id,
          extractor: "youtube",
          video_id: media.video_id,
          position: 0,
        })
        .execute();
      await t.db
        .insertInto("user_sources")
        .values({ user_id: u.userId, source_id: source.id, queued_at: AT })
        .execute();
      ids.push(source.id);
    }
    const listed = await listPlaylists(t.db, u.userId);
    expect(listed.map((p) => p.id)).toEqual(desc(ids));
  });

  it("lists what a person shares in one order, latest change first then by id", async () => {
    const u = await user();
    const shares: { id: string; entryId: string }[] = [];
    for (let i = 0; i < N; i++) {
      const { entryId } = await seedEntry(t.db, u.userId);
      const row = await t.db
        .insertInto("shares")
        .values({
          owner_id: u.userId,
          entry_id: entryId,
          mode: "link",
          code: `ordercode${randomUUID().replaceAll("-", "").slice(0, 13)}`,
          updated_at: AT,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      shares.push({ id: row.id, entryId });
    }
    const byShare = new Map(shares.map((s) => [s.id, s.entryId]));
    const listed = await listMyShares(t.db, u.userId);
    expect(listed.map((s) => s.id)).toEqual(
      desc(shares.map((s) => s.id)).map((id) => byShare.get(id)),
    );
  });

  it("lists unfinished uploads in one order, oldest first then by id", async () => {
    const u = await user();
    const rows = await t.db
      .insertInto("uploads")
      .values(
        Array.from({ length: N }, (_, i) => ({
          user_id: u.userId,
          filename: `clip${String(i)}.mp4`,
          size_bytes: 10,
          part_bytes: 8 * 1024 * 1024,
          ext: "mp4",
          title: `Clip ${String(i)}`,
          creator: "Me",
          storage_key: `uploads/${randomUUID()}.mp4`,
          store_upload_id: randomUUID(),
          created_at: AT,
        })),
      )
      .returning("id")
      .execute();
    const listed = await listUploads(t.db, u.userId);
    expect(listed.map((x) => x.id)).toEqual(asc(rows.map((r) => r.id)));
  });
});
