import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { exportJobKey, exportKey } from "./store.ts";
import { sweepExports } from "./sweep.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

async function copy(over: Record<string, unknown>, ageMinutes = 0): Promise<string> {
  const me = await signedIn(t.db, { username: `sw${String(Math.random()).slice(2, 10)}` });
  const e = await seedEntry(t.db, me.userId);
  const row = await t.db
    .insertInto("exports")
    .values({
      user_id: me.userId,
      entry_id: e.entryId,
      rendition_id: e.renditionId,
      cuts: JSON.stringify([{ start: 1, end: 2 }]),
      created_at: sql<Date>`now() - make_interval(mins => ${ageMinutes})`,
      ...over,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const state = async (id: string) =>
  (await t.db.selectFrom("exports").select("state").where("id", "=", id).executeTakeFirst())?.state;

describe("sweepExports", () => {
  it("drops a copy a day past finishing, trashing its file, and keeps a newer one", async () => {
    const id = crypto.randomUUID();
    const old = await copy({
      id,
      state: "done",
      storage_key: exportKey(id),
      size_bytes: 5,
      finished_at: sql<Date>`now() - interval '25 hours'`,
    });
    const fresh = await copy({ state: "failed", error: "x", finished_at: new Date() });
    await sweepExports(h.ctx);
    expect(await state(old)).toBeUndefined();
    expect(await state(fresh)).toBe("failed");
    const trash = await t.db
      .selectFrom("storage_trash")
      .select("key")
      .where("key", "=", exportKey(id))
      .execute();
    expect(trash).toHaveLength(1);
  });

  it("fails a copy whose job is gone, and leaves one that still has its job", async () => {
    const lost = await copy({ state: "running" }, 10);
    const waiting = await copy({}, 10);
    await h.ctx.queues.export.add("export", { exportId: waiting }, { key: exportJobKey(waiting) });
    const young = await copy({}, 0);
    await sweepExports(h.ctx);
    expect(await state(lost)).toBe("failed");
    expect(await state(waiting)).toBe("queued");
    expect(await state(young)).toBe("queued");
  });
});
