import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { testBus } from "../../test/bus.ts";
import { downloadHarness, post, seededDefault } from "../../test/downloads.ts";
import { eventually } from "../../test/eventually.ts";
import { TestDb } from "../../test/testDb.ts";
import { claim } from "../jobs/store.ts";
import { dispatchFor, queueDownload } from "./dispatch.ts";
import { fetchKey } from "./fetchKey.ts";
import type { FetchJob } from "./queues.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db, 3);
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

async function queue(userId: string, videoId: string, priority: 0 | 1 = 0): Promise<string> {
  const profile = await seededDefault(testDb.db);
  const out = await testDb.db.transaction().execute((tx) =>
    queueDownload(tx, {
      userId,
      requestId: null,
      extractor: "Youtube",
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: videoId,
      profile,
      priority,
    }),
  );
  return out.downloadId ?? "";
}

const dispatched = async (userId: string) =>
  testDb.db
    .selectFrom("downloads")
    .select(["id", "fetch_key"])
    .where("user_id", "=", userId)
    .where("dispatched_at", "is not", null)
    .where("state", "in", ["queued", "running"])
    .execute();

let n = 0;
const user = async (): Promise<SignedIn> => signedIn(testDb.db, { username: `d${String(++n)}` });

describe("per-user dispatch", () => {
  it("dispatches at most the limit, then one more as each settles", async () => {
    const u = await user();
    for (let i = 0; i < 10; i++) await queue(u.userId, `lim-${String(i)}`);
    expect(await dispatchFor(h.ctx, u.userId)).toBe(3);
    expect(await dispatched(u.userId)).toHaveLength(3);
    const [first] = await dispatched(u.userId);
    await testDb.db
      .updateTable("downloads")
      .set({ state: "done" })
      .where("id", "=", first?.id ?? "")
      .execute();
    expect(await dispatchFor(h.ctx, u.userId)).toBe(1);
    expect(await dispatched(u.userId)).toHaveLength(3);
  });

  it("dispatches pasted links before a backfill", async () => {
    const u = await user();
    const ctx = { ...h.ctx, limits: { ...h.ctx.limits, maxActivePerUser: 1 } };
    await queue(u.userId, "backfill-1", 1);
    const pasted = await queue(u.userId, "pasted-1", 0);
    expect(await dispatchFor(ctx, u.userId)).toBe(1);
    expect((await dispatched(u.userId)).map((d) => d.id)).toEqual([pasted]);
  });

  it("never over-dispatches when two settle at once", async () => {
    const u = await user();
    for (let i = 0; i < 8; i++) await queue(u.userId, `race-${String(i)}`);
    await Promise.all([
      dispatchFor(h.ctx, u.userId),
      dispatchFor(h.ctx, u.userId),
      dispatchFor(h.ctx, u.userId),
    ]);
    expect(await dispatched(u.userId)).toHaveLength(3);
  });

  it("shares one fetch job between two people asking for the same video", async () => {
    const [a, b] = [await user(), await user()];
    await queue(a.userId, "shared-1");
    await queue(b.userId, "shared-1");
    await dispatchFor(h.ctx, a.userId);
    await dispatchFor(h.ctx, b.userId);
    const p = await seededDefault(testDb.db);
    const key = fetchKey("youtube", "shared-1", p.id, p.revision);
    expect((await h.jobIds()).filter((id) => id === key)).toHaveLength(1);
  });

  it("snapshots the profile, so an edit after queueing changes nothing for that fetch", async () => {
    const u = await user();
    const id = await queue(u.userId, "snap-1");
    await dispatchFor(h.ctx, u.userId);
    const p = await seededDefault(testDb.db);
    const job = await h.queues.download.get(fetchKey("youtube", "snap-1", p.id, p.revision));
    await testDb.db
      .updateTable("format_profiles")
      .set({ format: "b", revision: "edited00000" })
      .where("id", "=", p.id)
      .execute();
    try {
      const row = await testDb.db
        .selectFrom("downloads")
        .select(["profile_revision", "args"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.profile_revision).toBe(p.revision);
      expect((row.args as { format: string }).format).toBe(p.format);
      expect((job?.data as FetchJob).revision).toBe(p.revision);
    } finally {
      await testDb.db
        .updateTable("format_profiles")
        .set({ format: p.format, revision: p.revision })
        .where("id", "=", p.id)
        .execute();
    }
  });
});

describe("cancel and retry", () => {
  it("leaves a shared fetch alone when another person still waits on it, and removes it when nobody does", async () => {
    const [a, b] = [await user(), await user()];
    const da = await queue(a.userId, "cancel-1");
    const db = await queue(b.userId, "cancel-1");
    await dispatchFor(h.ctx, a.userId);
    await dispatchFor(h.ctx, b.userId);
    const p = await seededDefault(testDb.db);
    const key = fetchKey("youtube", "cancel-1", p.id, p.revision);
    expect((await post(h.app(a), `/api/downloads/${da}/cancel`)).status).toBe(204);
    expect(await h.queues.download.get(key)).toBeDefined();
    expect((await post(h.app(b), `/api/downloads/${db}/cancel`)).status).toBe(204);
    expect(await h.queues.download.get(key)).toBeUndefined();
  });

  it("asks the worker to stop a fetch that is already running", async () => {
    const u = await user();
    const id = await queue(u.userId, "running-1");
    await dispatchFor(h.ctx, u.userId);
    const bus = testBus(testDb);
    await bus.ready;
    const messages: string[] = [];
    bus.on("uroboros_cancel", (m) => messages.push(m));
    try {
      const p = await seededDefault(testDb.db);
      const key = fetchKey("youtube", "running-1", p.id, p.revision);
      // A worker takes it.
      expect(
        await claim(testDb.db, "download", { limit: 100, leaseMs: 60_000, worker: "w" }),
      ).not.toHaveLength(0);
      expect((await h.queues.download.get(key))?.state).toBe("running");
      expect((await post(h.app(u), `/api/downloads/${id}/cancel`)).status).toBe(204);
      await eventually(() => {
        expect(messages.map((m) => (JSON.parse(m) as { fetchKey: string }).fetchKey)).toContain(
          key,
        );
      });
    } finally {
      await bus.close();
    }
  });

  it("retries a failed download, queueing it again from scratch", async () => {
    const u = await user();
    const id = await queue(u.userId, "retry-1");
    await testDb.db
      .updateTable("downloads")
      .set({ state: "failed", error_kind: "network", attempts: 3, stderr_tail: ["boom"] })
      .where("id", "=", id)
      .execute();
    expect((await post(h.app(u), `/api/downloads/${id}/retry`)).status).toBe(204);
    const row = await testDb.db
      .selectFrom("downloads")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ state: "queued", attempts: 0, error_kind: null, stderr_tail: [] });
    expect(row.dispatched_at).not.toBeNull();
    expect((await post(h.app(u), `/api/downloads/${id}/retry`)).status).toBe(409);
  });

  it("answers 404 when a member cancels someone else's download, and lets an admin", async () => {
    const [owner, other] = [await user(), await user()];
    const admin = await signedIn(testDb.db, { username: `dadmin${String(++n)}`, role: "admin" });
    const id = await queue(owner.userId, "own-1");
    expect((await post(h.app(other), `/api/downloads/${id}/cancel`)).status).toBe(404);
    expect((await post(h.app(admin), `/api/downloads/${id}/cancel`)).status).toBe(204);
  });
});

describe("GET /api/downloads", () => {
  it("lists the caller's own downloads, and everyone's only for an admin", async () => {
    const [a, b] = [await user(), await user()];
    const admin = await signedIn(testDb.db, { username: `ladmin${String(++n)}`, role: "admin" });
    await queue(a.userId, "list-a");
    await queue(b.userId, "list-b");
    const mine = (await (await h.app(a).request("/api/downloads")).json()) as {
      videoId: string;
      owner: { id: string };
    }[];
    expect(mine.map((d) => d.videoId)).toEqual(["list-a"]);
    expect((await h.app(a).request("/api/downloads?all=true")).status).toBe(403);
    const all = (await (await h.app(admin).request("/api/downloads?all=true")).json()) as {
      videoId: string;
    }[];
    expect(all.map((d) => d.videoId)).toEqual(expect.arrayContaining(["list-a", "list-b"]));
  });

  it("lists only the queued and running ones with active=true", async () => {
    const a = await user();
    await queue(a.userId, "act-q");
    const done = await queue(a.userId, "act-done");
    await testDb.db
      .updateTable("downloads")
      .set({ state: "done", finished_at: new Date() })
      .where("id", "=", done)
      .execute();
    const active = (await (await h.app(a).request("/api/downloads?active=true")).json()) as {
      videoId: string;
    }[];
    expect(active.map((d) => d.videoId)).toEqual(["act-q"]);
  });
});
