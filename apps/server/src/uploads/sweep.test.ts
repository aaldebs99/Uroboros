import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadHarness } from "../../test/downloads.ts";
import { liveJobs } from "../../test/jobs.ts";
import { seedProfileless } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { DEFAULT_LAYOUT, type StorageConfig } from "../storage/config.ts";
import { createStore } from "../storage/index.ts";
import {
  completeUpload,
  createUpload,
  FAILED_OTHERWISE,
  putUploadPart,
  type UploadContext,
} from "./store.ts";
import { sweepUploads } from "./sweep.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let root: string;
let ctx: UploadContext;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  root = await mkdtemp(join(tmpdir(), "uroboros-sweep-"));
  const storage: StorageConfig = { kind: "filesystem", root, layout: DEFAULT_LAYOUT };
  ctx = { ...h.ctx, store: createStore(storage), storage, partBytes: 4 };
});
afterAll(async () => {
  await h.close();
  await t.close();
});

async function started(username: string): Promise<{ id: string; userId: string; dir: string }> {
  const userId = await insertUser(t.db, { username });
  const up = await createUpload(ctx, userId, { filename: "a.mp4", size: 10, title: "A", tags: [] });
  await putUploadPart(ctx, userId, up.id, 1, Buffer.from("abcd"));
  const { storage_key } = await t.db
    .selectFrom("uploads")
    .select("storage_key")
    .where("id", "=", up.id)
    .executeTakeFirstOrThrow();
  return { id: up.id, userId, dir: join(root, dirname(storage_key)) };
}

async function processing(username: string) {
  const s = await started(username);
  await putUploadPart(ctx, s.userId, s.id, 2, Buffer.from("efgh"));
  await putUploadPart(ctx, s.userId, s.id, 3, Buffer.from("ij"));
  await completeUpload(ctx, s.userId, s.id);
  return s;
}

const age = (id: string, interval: string) =>
  t.db
    .updateTable("uploads")
    .set({ touched_at: sql`now() - ${interval}::interval` })
    .where("id", "=", id)
    .execute();

const stateOf = async (id: string) =>
  (await t.db.selectFrom("uploads").select("state").where("id", "=", id).executeTakeFirst())?.state;

describe("the upload sweep", () => {
  it("gives back the job of an upload being processed that lost it", async () => {
    const s = await processing("upsweep1");
    await t.db.deleteFrom("jobs").where("key", "=", `upload|${s.id}`).execute();
    await sweepUploads(ctx, ctx.store);
    expect((await liveJobs(t.db, "upload")).map((j) => j.key)).toContain(`upload|${s.id}`);
    await sweepUploads(ctx, ctx.store);
    expect((await liveJobs(t.db, "upload")).filter((j) => j.key === `upload|${s.id}`)).toHaveLength(
      1,
    );
  });

  it("fails an upload processing for over six hours", async () => {
    const s = await processing("upsweep2");
    await age(s.id, "7 hours");
    await sweepUploads(ctx, ctx.store);
    const row = await t.db
      .selectFrom("uploads")
      .select(["state", "error"])
      .where("id", "=", s.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: "failed", error: FAILED_OTHERWISE });
  });

  it("drops an upload untouched for a day, and one whose person is gone, with their bytes", async () => {
    const idle = await started("upsweep3");
    const orphan = await started("upsweep4");
    const fresh = await started("upsweep5");
    await age(idle.id, "25 hours");
    await t.db.deleteFrom("users").where("id", "=", orphan.userId).execute();
    await sweepUploads(ctx, ctx.store);
    expect(await stateOf(idle.id)).toBeUndefined();
    expect(await stateOf(orphan.id)).toBeUndefined();
    expect(await stateOf(fresh.id)).toBe("receiving");
    for (const gone of [idle, orphan]) {
      expect(await readdir(gone.dir).catch(() => [])).toEqual([]);
    }
  });

  it("keeps an abandoned upload whose bytes the store can't drop, for the next sweep", async () => {
    const stuck = await started("upsweep7");
    const fine = await started("upsweep8");
    await age(stuck.id, "25 hours");
    await age(fine.id, "25 hours");
    const { storage_key: stuckKey } = await t.db
      .selectFrom("uploads")
      .select("storage_key")
      .where("id", "=", stuck.id)
      .executeTakeFirstOrThrow();
    const flaky = {
      ...ctx.store,
      abortUpload: (key: string, uploadId: string) =>
        key === stuckKey
          ? Promise.reject(new Error("the store is down"))
          : ctx.store.abortUpload(key, uploadId),
    };
    await sweepUploads(ctx, flaky);
    expect(await stateOf(stuck.id)).toBe("receiving");
    expect(await stateOf(fine.id)).toBeUndefined();
    await sweepUploads(ctx, ctx.store);
    expect(await stateOf(stuck.id)).toBeUndefined();
    expect(await readdir(stuck.dir).catch(() => [])).toEqual([]);
  });

  it("forgets a done upload after a day (its video stays) and a failed one after a week", async () => {
    const me = await insertUser(t.db, { username: "upsweep6" });
    const entry = await seedProfileless(t.db, me);
    const row = (state: "done" | "failed", extra: Record<string, unknown> = {}) =>
      t.db
        .insertInto("uploads")
        .values({
          user_id: me,
          filename: "a.mp4",
          size_bytes: 10,
          part_bytes: 4,
          ext: "mp4",
          title: "A",
          creator: "Me",
          storage_key: `swept/${String(Math.random())}.mp4`,
          store_upload_id: "0123456789abcdef01234567",
          state,
          ...extra,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    const done = await row("done", { entry_id: entry.entryId });
    const oldFailed = await row("failed");
    const newFailed = await row("failed");
    await age(done.id, "25 hours");
    await age(oldFailed.id, "8 days");
    await age(newFailed.id, "2 days");
    await sweepUploads(ctx, ctx.store);
    expect(await stateOf(done.id)).toBeUndefined();
    expect(await stateOf(oldFailed.id)).toBeUndefined();
    expect(await stateOf(newFailed.id)).toBe("failed");
    const kept = await t.db
      .selectFrom("library_entries")
      .select("id")
      .where("id", "=", entry.entryId)
      .execute();
    expect(kept).toHaveLength(1);
  });
});
