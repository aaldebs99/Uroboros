import { randomUUID } from "node:crypto";
import { CancelledBatch, DownloadBatch, ReadyPreview } from "@uroboros/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { testBus } from "../../test/bus.ts";
import { downloadHarness, post, seededDefault } from "../../test/downloads.ts";
import { eventually } from "../../test/eventually.ts";
import { TestDb } from "../../test/testDb.ts";
import type { PgBus } from "../db/notifications.ts";
import { dispatchFor, queueDownload } from "./dispatch.ts";
import { fetchKey } from "./fetchKey.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let bus: PgBus;
let n = 0;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db, 3);
  bus = testBus(testDb);
  await bus.ready;
});
afterAll(async () => {
  await bus.close();
  await h.close();
  await testDb.close();
});

const person = (): Promise<SignedIn> => signedIn(testDb.db, { username: `batch${String(++n)}` });

type RequestColumns = {
  state?: "probing" | "choosing" | "queued" | "failed";
  kind?: "video" | "playlist" | "channel";
  intent?: "download" | "subscribe" | "search";
};

/** A pasted link of `userId`'s: by default a playlist waiting for its pick. */
async function request(userId: string, columns: RequestColumns = {}): Promise<string> {
  const row = await testDb.db
    .insertInto("download_requests")
    .values({
      user_id: userId,
      url: `https://www.youtube.com/playlist?list=${randomUUID()}`,
      profile_id: (await seededDefault(testDb.db)).id,
      state: "choosing",
      kind: "playlist",
      title: "A playlist",
      entries: JSON.stringify([]),
      ...columns,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Queues `videoId` for `userId` as one of `requestId`'s videos; answers the download's id. */
async function queued(userId: string, requestId: string | null, videoId: string): Promise<string> {
  const profile = await seededDefault(testDb.db);
  const out = await testDb.db.transaction().execute((tx) =>
    queueDownload(tx, {
      userId,
      requestId,
      extractor: "Youtube",
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: videoId,
      profile,
    }),
  );
  return out.downloadId ?? "";
}

const setState = (id: string, state: "running" | "done" | "failed") =>
  testDb.db.updateTable("downloads").set({ state }).where("id", "=", id).execute();

const stateOf = async (id: string) =>
  (
    await testDb.db
      .selectFrom("downloads")
      .select(["state", "dispatched_at"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
  ).state;

const discard = (s: SignedIn, id: string) =>
  h.app(s).request(`/api/downloads/requests/${id}`, { method: "DELETE" });

const batches = async (s: SignedIn) => {
  const res = await h.app(s).request("/api/downloads/batches");
  expect(res.status).toBe(200);
  return z.array(DownloadBatch).parse(await res.json());
};

const key = async (videoId: string) => {
  const p = await seededDefault(testDb.db);
  return fetchKey("youtube", videoId, p.id, p.revision);
};

/** Everything said on the downloads channel while `fn` runs, and a little after. */
async function heard(fn: () => Promise<void>, want: unknown): Promise<void> {
  const messages: unknown[] = [];
  const off = bus.on("uroboros_downloads", (payload) => messages.push(JSON.parse(payload)));
  try {
    await fn();
    await eventually(() => {
      expect(messages).toContainEqual(want);
    });
  } finally {
    off();
  }
}

describe("discarding a playlist before picking from it", () => {
  it("deletes it at once and tells the person's open tabs", async () => {
    const alice = await person();
    const id = await request(alice.userId);
    await heard(
      async () => {
        expect((await discard(alice, id)).status).toBe(204);
      },
      { kind: "requests", userId: alice.userId },
    );
    expect((await h.app(alice).request(`/api/downloads/requests/${id}`)).status).toBe(404);
    const ready = z
      .array(ReadyPreview)
      .parse(await (await h.app(alice).request("/api/downloads/requests")).json());
    expect(ready.map((p) => p.id)).not.toContain(id);
  });

  it("answers 404 for another person's, and 409 for one being looked at, queued or failed", async () => {
    const [owner, other] = [await person(), await person()];
    const theirs = await request(owner.userId);
    expect((await discard(other, theirs)).status).toBe(404);
    for (const state of ["probing", "queued", "failed"] as const) {
      const id = await request(owner.userId, { state });
      expect((await discard(owner, id)).status).toBe(409);
      expect((await h.app(owner).request(`/api/downloads/requests/${id}`)).status).toBe(200);
    }
    expect((await h.app(owner).request(`/api/downloads/requests/${theirs}`)).status).toBe(200);
  });
});

describe("a queued playlist's videos, together", () => {
  it("lists the person's queued playlists with videos still waiting, with their counts", async () => {
    const [bob, other] = [await person(), await person()];
    const batch = await request(bob.userId, { state: "queued" });
    const [w1, w2, d1, f1] = [
      await queued(bob.userId, batch, "list-w1"),
      await queued(bob.userId, batch, "list-w2"),
      await queued(bob.userId, batch, "list-d1"),
      await queued(bob.userId, batch, "list-f1"),
    ];
    await setState(w2, "running");
    await setState(d1, "done");
    await setState(f1, "failed");
    // Not batches: a single video, a search's results, a finished playlist, another person's.
    const single = await request(bob.userId, { state: "queued", kind: "video" });
    await queued(bob.userId, single, "list-single");
    const search = await request(bob.userId, { state: "choosing", intent: "search" });
    await queued(bob.userId, search, "list-search");
    const finished = await request(bob.userId, { state: "queued" });
    await setState(await queued(bob.userId, finished, "list-finished"), "done");
    const theirs = await request(other.userId, { state: "queued" });
    await queued(other.userId, theirs, "list-theirs");

    expect(await batches(bob)).toEqual([
      {
        id: batch,
        url: expect.stringContaining("playlist?list=") as string,
        title: "A playlist",
        kind: "playlist",
        waiting: 2,
        done: 1,
        failed: 1,
      },
    ]);
    expect(w1).not.toBe("");
  });

  it("cancels its queued and downloading videos only, and dispatches the person's next ones", async () => {
    const [carol, dave] = [await person(), await person()];
    const batch = await request(carol.userId, { state: "queued" });
    const [b1, b2, b3] = [
      await queued(carol.userId, batch, "rest-b1"),
      await queued(carol.userId, batch, "rest-b2"),
      await queued(carol.userId, batch, "rest-b3"),
    ];
    const kept = await queued(carol.userId, batch, "rest-done");
    await setState(kept, "done");
    // Another of hers, past her three at once, and someone else waiting on b1's fetch.
    const other = await queued(
      carol.userId,
      await request(carol.userId, { state: "queued" }),
      "rest-o1",
    );
    await dispatchFor(h.ctx, carol.userId);
    await setState(b2, "running");
    const daves = await queued(dave.userId, null, "rest-b1");
    await dispatchFor(h.ctx, dave.userId);

    let res: Response | undefined;
    await heard(
      async () => {
        res = await post(h.app(carol), `/api/downloads/requests/${batch}/cancel`);
      },
      { kind: "requests", userId: carol.userId },
    );
    expect(res?.status).toBe(200);
    expect(CancelledBatch.parse(await res?.json())).toEqual({ cancelled: 3 });

    for (const id of [b1, b2, b3]) expect(await stateOf(id)).toBe("cancelled");
    expect(await stateOf(kept)).toBe("done");
    expect(await stateOf(daves)).toBe("queued");
    // b1's fetch still has Dave; b3's had nobody else.
    expect(await h.queues.download.get(await key("rest-b1"))).toBeDefined();
    expect(await h.queues.download.get(await key("rest-b3"))).toBeUndefined();
    const next = await testDb.db
      .selectFrom("downloads")
      .select("dispatched_at")
      .where("id", "=", other)
      .executeTakeFirstOrThrow();
    expect(next.dispatched_at).not.toBeNull();
    expect(await batches(carol)).toEqual([
      expect.objectContaining({ waiting: 1, done: 0, failed: 0 }),
    ]);
  });

  it("answers 404 for another person's, and 409 for a playlist not queued", async () => {
    const [owner, other] = [await person(), await person()];
    const batch = await request(owner.userId, { state: "queued" });
    await queued(owner.userId, batch, "refuse-1");
    expect((await post(h.app(other), `/api/downloads/requests/${batch}/cancel`)).status).toBe(404);
    const picking = await request(owner.userId);
    expect((await post(h.app(owner), `/api/downloads/requests/${picking}/cancel`)).status).toBe(
      409,
    );
    expect((await batches(owner)).map((b) => b.waiting)).toEqual([1]);
  });
});
