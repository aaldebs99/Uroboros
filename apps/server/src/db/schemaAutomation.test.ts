import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";

let t: TestDb;
beforeEach(async () => {
  t = await TestDb.create();
});
afterEach(async () => {
  await t.close();
});

async function errCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

async function user(): Promise<string> {
  const row = await t.db
    .insertInto("users")
    .values({
      username: `u${randomUUID().slice(0, 8)}`,
      password_hash: "x",
      display_name: "U",
      role: "member",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function profileId(): Promise<string> {
  const p = await t.db.selectFrom("format_profiles").select("id").executeTakeFirstOrThrow();
  return p.id;
}

/** A media row, one rendition of it and one person's entry. */
async function entry(userId: string) {
  const pid = await profileId();
  const m = await t.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: randomUUID() })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: pid,
      profile_revision: "rev",
      storage_key: `media/${m.id}`,
      size_bytes: 1,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const e = await t.db
    .insertInto("library_entries")
    .values({ user_id: userId, media_id: m.id, rendition_id: r.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { mediaId: m.id, renditionId: r.id, entryId: e.id, profileId: pid };
}

async function subscription(userId: string, sourceId = "UC1") {
  return t.db
    .insertInto("subscriptions")
    .values({
      user_id: userId,
      kind: "channel",
      extractor: "youtube",
      source_id: sourceId,
      title: "Blender",
      url: "https://www.youtube.com/@BlenderOfficial",
      feeds: JSON.stringify([{ name: "Videos", url: "https://www.youtube.com/@b/videos" }]),
      tabs: JSON.stringify([{ name: "Videos", url: "https://www.youtube.com/@b/videos" }]),
      profile_id: await profileId(),
      interval_minutes: 360,
      backfill: "none",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
}

describe("schema: automation", () => {
  it("refuses deleting a rendition an entry uses (restrict)", async () => {
    const e = await entry(await user());
    expect(
      await errCode(t.db.deleteFrom("renditions").where("id", "=", e.renditionId).execute()),
    ).toBe("23001");
  });

  it("refuses a second subscription to one source for one person", async () => {
    const u = await user();
    await subscription(u);
    expect(await errCode(subscription(u))).toBe("23505");
    // Someone else may follow the same channel.
    await subscription(await user());
  });

  it("keeps entries and downloads when their subscription goes", async () => {
    const u = await user();
    const s = await subscription(u);
    const e = await entry(u);
    await t.db
      .updateTable("library_entries")
      .set({ subscription_id: s.id })
      .where("id", "=", e.entryId)
      .execute();
    const d = await t.db
      .insertInto("downloads")
      .values({
        user_id: u,
        profile_id: e.profileId,
        profile_revision: "rev",
        args: JSON.stringify({}),
        extractor: "youtube",
        video_id: "v",
        url: "https://www.youtube.com/watch?v=v",
        fetch_key: "fetch|youtube|v|p|rev",
        subscription_id: s.id,
        priority: 1,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto("subscription_items")
      .values({
        subscription_id: s.id,
        extractor: "youtube",
        video_id: "v",
        url: "https://www.youtube.com/watch?v=v",
        outcome: "queued",
        download_id: d.id,
      })
      .execute();
    await t.db.deleteFrom("subscriptions").where("id", "=", s.id).execute();
    const kept = await t.db
      .selectFrom("library_entries")
      .select(["subscription_id", "kept"])
      .where("id", "=", e.entryId)
      .executeTakeFirstOrThrow();
    expect(kept).toEqual({ subscription_id: null, kept: false });
    const dl = await t.db
      .selectFrom("downloads")
      .select(["subscription_id", "priority"])
      .where("id", "=", d.id)
      .executeTakeFirstOrThrow();
    expect(dl).toEqual({ subscription_id: null, priority: 1 });
    expect(await t.db.selectFrom("subscription_items").selectAll().execute()).toEqual([]);
  });

  it("refuses an unknown item outcome", async () => {
    const s = await subscription(await user());
    expect(
      await errCode(
        t.db
          .insertInto("subscription_items")
          .values({
            subscription_id: s.id,
            extractor: "youtube",
            video_id: "v",
            url: "u",
            outcome: "maybe" as "queued",
          })
          .execute(),
      ),
    ).toBe("23514");
  });

  it("keeps one trash row per storage key", async () => {
    await t.db.insertInto("storage_trash").values({ key: "media/a" }).execute();
    expect(
      await errCode(t.db.insertInto("storage_trash").values({ key: "media/a" }).execute()),
    ).toBe("23505");
  });
});
