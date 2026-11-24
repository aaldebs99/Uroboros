import { PreviewWork } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { queuePreview } from "./queue.ts";

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

describe("GET /api/previews", () => {
  it("answers the caller's previews being made", async () => {
    const me = await signedIn(t.db, { username: "prroute" });
    const e = await seedEntry(t.db, me.userId, { title: "Holiday" });
    await t.db
      .updateTable("renditions")
      .set({ video_codec: "h264" })
      .where("id", "=", e.renditionId)
      .execute();
    await queuePreview(h.ctx, e.mediaId);
    const app = asUser(
      createApp({ db: t.db, version: "t", logger: pino({ level: "silent" }) }, { webDist: null }),
      me,
    );
    const res = await app.request("/api/previews");
    expect(res.status).toBe(200);
    expect(PreviewWork.parse(await res.json())).toEqual({
      queued: 1,
      left: 1,
      made: 0,
      next: { entryId: e.entryId, title: "Holiday", running: false },
    });
  });
});
