import { LibraryEntry } from "@uroboros/contract";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let alice: SignedIn;
let bob: SignedIn;
let entryId: string;
let renditionId: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
  alice = await signedIn(testDb.db, { username: "lalice" });
  bob = await signedIn(testDb.db, { username: "lbob" });
  const p = await seededDefault(testDb.db);
  const media = await testDb.db
    .insertInto("media")
    .values({
      extractor: "youtube",
      video_id: "lib1",
      title: "Big Buck Bunny",
      channel: "Blender",
      upload_date: "20080520",
      duration: 596,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await testDb.db
    .insertInto("renditions")
    .values({
      media_id: media.id,
      profile_id: p.id,
      profile_revision: p.revision,
      storage_key: "k/v.mp4",
      size_bytes: 1234,
      container: "mp4",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  renditionId = r.id;
  const e = await testDb.db
    .insertInto("library_entries")
    .values({ user_id: alice.userId, media_id: media.id, rendition_id: r.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  entryId = e.id;
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

describe("library", () => {
  it("lists only the caller's entries, with the profile name", async () => {
    const mine = z
      .array(LibraryEntry)
      .parse(await (await h.app(alice).request("/api/library")).json());
    expect(mine).toEqual([
      expect.objectContaining({
        id: entryId,
        title: "Big Buck Bunny",
        channel: "Blender",
        uploadDate: "2008-05-20",
        profileName: "Best up to 1080p (MP4)",
        sizeBytes: 1234,
        container: "mp4",
      }),
    ]);
    expect(
      z.array(LibraryEntry).parse(await (await h.app(bob).request("/api/library")).json()),
    ).toEqual([]);
  });

  it("answers 404 for another person's entry, and removes only the entry for its owner", async () => {
    expect((await h.app(bob).request(`/api/library/${entryId}`, { method: "DELETE" })).status).toBe(
      404,
    );
    expect(
      (await h.app(alice).request(`/api/library/${entryId}`, { method: "DELETE" })).status,
    ).toBe(204);
    const r = await testDb.db
      .selectFrom("renditions")
      .select("id")
      .where("id", "=", renditionId)
      .executeTakeFirst();
    expect(r?.id).toBe(renditionId);
  });
});
