import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import type { TranscodeState } from "../db/schema.ts";
import { sweepRenditions, sweepTranscodes } from "./reaper.ts";

const DAY = 86_400_000;
let t: TestDb;

beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

async function rendition(orphanedDaysAgo: number | null = null): Promise<string> {
  const p = await seededDefault(t.db);
  const m = await t.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: randomUUID() })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: p.id,
      profile_revision: p.revision,
      storage_key: `media/${m.id}`,
      size_bytes: 1,
      orphaned_at: orphanedDaysAgo === null ? null : new Date(Date.now() - orphanedDaysAgo * DAY),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return r.id;
}

async function copy(
  renditionId: string,
  state: TranscodeState,
  usedDaysAgo: number,
  createdDaysAgo = usedDaysAgo,
) {
  const c = await t.db
    .insertInto("transcodes")
    .values({
      source_rendition_id: renditionId,
      encoder: "libx264",
      settings: randomUUID().slice(0, 12),
      state,
      last_used_at: new Date(Date.now() - usedDaysAgo * DAY),
      created_at: new Date(Date.now() - createdDaysAgo * DAY),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return c.id;
}

const exists = async (id: string) =>
  (await t.db.selectFrom("transcodes").select("id").where("id", "=", id).executeTakeFirst()) !==
  undefined;
const trash = async () =>
  (await t.db.selectFrom("storage_trash").select("key").execute()).map((r) => r.key);

describe("the reaper and playback copies", () => {
  it("removes copies unused for longer than the keep days, and failed ones after a day", async () => {
    const r = await rendition();
    const old = await copy(r, "done", 31);
    const recent = await copy(r, "done", 3);
    const failed = await copy(r, "failed", 0, 2);
    const freshFail = await copy(r, "failed", 0, 0);
    expect(await sweepTranscodes(t.db, 30)).toBe(2);
    expect([
      await exists(old),
      await exists(recent),
      await exists(failed),
      await exists(freshFail),
    ]).toEqual([false, true, false, true]);
    expect(await trash()).toEqual(
      expect.arrayContaining([`.transcodes/${old}/`, `.transcodes/${failed}/`]),
    );
  });

  it("keeps a running copy whatever its age", async () => {
    const r = await rendition();
    const running = await copy(r, "running", 90);
    const queued = await copy(r, "queued", 90);
    await sweepTranscodes(t.db, 30);
    expect([await exists(running), await exists(queued)]).toEqual([true, true]);
  });

  it("a swept rendition trashes its copies' files", async () => {
    const r = await rendition(2);
    const c = await copy(r, "done", 0);
    expect(await sweepRenditions(t.db, DAY)).toBeGreaterThanOrEqual(1);
    expect(await exists(c)).toBe(false);
    expect(await trash()).toContain(`.transcodes/${c}/`);
  });
});
