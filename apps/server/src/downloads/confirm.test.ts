import { Download } from "@uroboros/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { queuedFetch } from "../../test/fetchJobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { retryDownload } from "./dispatch.ts";
import { releaseHolds } from "./reconcile.ts";

/** Confirming a download held for its size (docs/downloads.md "Large downloads"). */

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let ann: SignedIn;
let ben: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  ann = await signedIn(t.db, { username: "cfann" });
  ben = await signedIn(t.db, { username: "cfben" });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

/** A download of `videoId` for `who`, held as a fetch holds it: queued, undispatched, 36 GB. */
async function held(who: SignedIn, videoId: string): Promise<string> {
  await queuedFetch(t.db, videoId, [who]);
  const row = await t.db
    .updateTable("downloads")
    .set({ size_held_bytes: 36 * 1024 ** 3, size_held_at: new Date() })
    .where("video_id", "=", videoId)
    .where("user_id", "=", who.userId)
    .returning(["id", "fetch_key"])
    .executeTakeFirstOrThrow();
  return row.id;
}

const confirm = (who: SignedIn, id: string) =>
  h.app(who).request(`/api/downloads/${id}/confirm`, { method: "POST" });

const listed = async (who: SignedIn, id: string) => {
  const res = await h.app(who).request("/api/downloads");
  return Download.array()
    .parse(await res.json())
    .find((d) => d.id === id);
};

describe("POST /api/downloads/{id}/confirm", () => {
  it("shows a held download with its estimate and the limit, and lets it go ahead", async () => {
    const id = await held(ann, "cf-1");
    expect((await listed(ann, id))?.sizeHold).toEqual({
      expectedBytes: 36 * 1024 ** 3,
      limitBytes: 30 * 1024 ** 3,
    });

    const res = await confirm(ann, id);
    expect(res.status).toBe(204);
    const row = await t.db
      .selectFrom("downloads")
      .select(["fetch_key", "dispatched_at", "size_held_at", "size_ok_at"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ size_held_at: null });
    expect(row.size_ok_at).not.toBeNull();
    expect(row.dispatched_at).not.toBeNull();
    expect(await h.jobIds()).toContain(row.fetch_key);
    expect((await listed(ann, id))?.sizeHold).toBeNull();
  });

  it("is 404 for someone else's download and 409 for one not held", async () => {
    const id = await held(ann, "cf-2");
    expect((await confirm(ben, id)).status).toBe(404);
    expect((await confirm(ann, id)).status).toBe(204);
    expect((await confirm(ann, id)).status).toBe(409);
  });

  it("asks again after a held download is cancelled and retried", async () => {
    const id = await held(ben, "cf-3");
    const cancel = await h.app(ben).request(`/api/downloads/${id}/cancel`, { method: "POST" });
    expect(cancel.status).toBe(204);
    await retryDownload(h.ctx, { userId: ben.userId, role: "member", via: "session" }, id);
    const row = await t.db
      .selectFrom("downloads")
      .select(["state", "size_held_at", "size_ok_at", "dispatched_at"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    // Queued for a fetch again, which asks yt-dlp the size anew.
    expect(row).toMatchObject({ state: "queued", size_held_at: null, size_ok_at: null });
    expect(row.dispatched_at).not.toBeNull();
  });
});

describe("a limit raised or turned off", () => {
  it("lets go of the holds it no longer makes, and dispatches them", async () => {
    const cal = await signedIn(t.db, { username: "cfcal" });
    const id = await held(cal, "cf-4");
    const statesOf = () =>
      t.db
        .selectFrom("downloads")
        .select(["size_held_at", "dispatched_at"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
    // Still over the limit (36 GB against 30): kept.
    await releaseHolds(h.ctx);
    expect((await statesOf()).size_held_at).not.toBeNull();

    for (const limit of [40 * 1024 ** 3, 0]) {
      await t.db
        .updateTable("downloads")
        .set({ size_held_bytes: 36 * 1024 ** 3, size_held_at: new Date(), dispatched_at: null })
        .where("id", "=", id)
        .execute();
      const raised = { ...h.ctx, limits: { ...h.ctx.limits, largeDownloadBytes: limit } };
      expect(await releaseHolds(raised)).toBeGreaterThanOrEqual(1);
      const row = await statesOf();
      expect(row.size_held_at).toBeNull();
      expect(row.dispatched_at).not.toBeNull();
    }
  });
});
