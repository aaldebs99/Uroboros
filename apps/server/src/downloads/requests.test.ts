import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import { DownloadRequest, QueueSelectionResult } from "@uroboros/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness, post, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { sweepExpiredRequests } from "./requests.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let alice: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
  alice = await signedIn(testDb.db, { username: "ralice" });
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

const entry = (id: string) => ({
  id,
  extractor: "youtube",
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Video ${id}`,
  duration: 10,
  uploader: "Blender",
  thumbnailUrl: null,
});

/** A request the worker has probed into a preview. */
async function choosing(userId: string, ids: string[]): Promise<string> {
  const p = await seededDefault(testDb.db);
  const row = await testDb.db
    .insertInto("download_requests")
    .values({
      user_id: userId,
      url: "https://www.youtube.com/playlist?list=x",
      profile_id: p.id,
      state: "choosing",
      kind: "playlist",
      title: "A playlist",
      entries: JSON.stringify([
        { name: "Videos", ticked: true, truncated: false, entries: ids.map(entry) },
      ]),
      source_extractor: "youtubetab",
      source_id: `PL-${ids.join("-")}`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("POST /api/downloads", () => {
  it("refuses a URL that is not http(s)", async () => {
    expect((await post(h.app(alice), "/api/downloads", { url: "file:///etc/passwd" })).status).toBe(
      400,
    );
  });

  it("takes a link without a scheme as an https one", async () => {
    const res = await post(h.app(alice), "/api/downloads", { url: " twitch.tv/channel " });
    expect(res.status).toBe(202);
    expect(DownloadRequest.parse(await res.json()).url).toBe("https://twitch.tv/channel");
  });

  it("creates a probing request on the default profile and a probe job", async () => {
    const res = await post(h.app(alice), "/api/downloads", {
      url: "https://www.youtube.com/watch?v=a",
    });
    expect(res.status).toBe(202);
    const req = DownloadRequest.parse(await res.json());
    expect(req).toMatchObject({ state: "probing", kind: null, groups: [] });
    expect(req.profileId).toBe((await seededDefault(testDb.db)).id);
    expect(await h.queues.probe.get(`probe|${req.id}`)).toBeDefined();
  });

  it("records the request and its probe job together, or neither", async () => {
    // The jobs table refuses probe jobs for a moment: the request must not be left behind.
    await sql`ALTER TABLE jobs ADD CONSTRAINT refuse_probe CHECK (queue <> 'probe') NOT VALID`.execute(
      testDb.db,
    );
    try {
      const before = await testDb.db.selectFrom("download_requests").select("id").execute();
      const res = await post(h.app(alice), "/api/downloads", {
        url: "https://www.youtube.com/watch?v=refused",
      });
      expect(res.status).toBe(500);
      expect(await testDb.db.selectFrom("download_requests").select("id").execute()).toEqual(
        before,
      );
    } finally {
      await sql`ALTER TABLE jobs DROP CONSTRAINT refuse_probe`.execute(testDb.db);
    }
  });

  it("records why the link was pasted: to download (the default) or to subscribe", async () => {
    const intents = [];
    for (const body of [
      { url: "https://www.youtube.com/@a" },
      { url: "https://www.youtube.com/@b", intent: "subscribe" },
    ]) {
      const req = DownloadRequest.parse(
        await (await post(h.app(alice), "/api/downloads", body)).json(),
      );
      const row = await testDb.db
        .selectFrom("download_requests")
        .select("intent")
        .where("id", "=", req.id)
        .executeTakeFirstOrThrow();
      intents.push(row.intent);
    }
    expect(intents).toEqual(["download", "subscribe"]);
    const bad = await post(h.app(alice), "/api/downloads", {
      url: "https://www.youtube.com/@c",
      intent: "later",
    });
    expect(bad.status).toBe(400);
  });

  it("refuses an unknown profile (400)", async () => {
    const res = await post(h.app(alice), "/api/downloads", {
      url: "https://www.youtube.com/watch?v=a",
      profileId: randomUUID(),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/downloads/requests/{id}/queue", () => {
  it("queues the ticked entries and skips what the person already has", async () => {
    const id = await choosing(alice.userId, ["q1", "q2", "q3"]);
    const res = await post(h.app(alice), `/api/downloads/requests/${id}/queue`, {
      entryIds: ["q1", "q2", "q3"],
    });
    expect(QueueSelectionResult.parse(await res.json())).toEqual({ queued: 3, skipped: 0 });
    const again = await choosing(alice.userId, ["q1", "q4"]);
    const second = await post(h.app(alice), `/api/downloads/requests/${again}/queue`, {
      entryIds: ["q1", "q4"],
    });
    expect(QueueSelectionResult.parse(await second.json())).toEqual({ queued: 1, skipped: 1 });
    const req = DownloadRequest.parse(
      await (await h.app(alice).request(`/api/downloads/requests/${id}`)).json(),
    );
    expect(req.state).toBe("queued");
  });

  it("refuses an entry that is not in the preview (400) and a request that is not choosing (409)", async () => {
    const id = await choosing(alice.userId, ["n1"]);
    expect(
      (await post(h.app(alice), `/api/downloads/requests/${id}/queue`, { entryIds: ["zzz"] }))
        .status,
    ).toBe(400);
    const probing = await testDb.db
      .insertInto("download_requests")
      .values({
        user_id: alice.userId,
        url: "https://x.example/v",
        profile_id: (await seededDefault(testDb.db)).id,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(
      (
        await post(h.app(alice), `/api/downloads/requests/${probing.id}/queue`, {
          entryIds: ["n1"],
        })
      ).status,
    ).toBe(409);
  });

  it("answers 404 for another person's request", async () => {
    const bob = await signedIn(testDb.db, { username: "rbob" });
    const id = await choosing(alice.userId, ["b1"]);
    expect(
      (await post(h.app(bob), `/api/downloads/requests/${id}/queue`, { entryIds: ["b1"] })).status,
    ).toBe(404);
    // Reading it, or its picks, is no different.
    expect((await h.app(bob).request(`/api/downloads/requests/${id}`)).status).toBe(404);
    expect(
      (
        await h.app(bob).request(`/api/downloads/requests/${id}/selection`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryIds: [] }),
        })
      ).status,
    ).toBe(404);
    expect((await h.app(alice).request(`/api/downloads/requests/${id}`)).status).toBe(200);
  });

  it("finishes at once, without a job, when the rendition is already stored", async () => {
    const p = await seededDefault(testDb.db);
    const media = await testDb.db
      .insertInto("media")
      .values({ extractor: "youtube", video_id: "stored1", title: "Stored" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await testDb.db
      .insertInto("renditions")
      .values({
        media_id: media.id,
        profile_id: p.id,
        profile_revision: p.revision,
        storage_key: "k",
        size_bytes: 5,
      })
      .execute();
    const carol = await signedIn(testDb.db, { username: "rcarol" });
    const id = await choosing(carol.userId, ["stored1"]);
    await post(h.app(carol), `/api/downloads/requests/${id}/queue`, { entryIds: ["stored1"] });
    const d = await testDb.db
      .selectFrom("downloads")
      .select(["state", "rendition_id", "fetch_key"])
      .where("user_id", "=", carol.userId)
      .executeTakeFirstOrThrow();
    expect(d.state).toBe("done");
    expect(d.rendition_id).not.toBeNull();
    expect(await h.queues.download.get(d.fetch_key)).toBeUndefined();
    const lib = await testDb.db
      .selectFrom("library_entries")
      .selectAll()
      .where("user_id", "=", carol.userId)
      .execute();
    expect(lib).toHaveLength(1);
  });
});

describe("playlists", () => {
  it("records a queued playlist, who queued it, and its order; a channel records nothing", async () => {
    const id = await choosing(alice.userId, ["pl1", "pl2"]);
    await post(h.app(alice), `/api/downloads/requests/${id}/queue`, { entryIds: ["pl2"] });
    const source = await testDb.db
      .selectFrom("sources")
      .selectAll()
      .where("source_id", "=", "PL-pl1-pl2")
      .executeTakeFirstOrThrow();
    expect(source).toMatchObject({
      extractor: "youtubetab",
      kind: "playlist",
      title: "A playlist",
    });
    const owners = await testDb.db
      .selectFrom("user_sources")
      .select("user_id")
      .where("source_id", "=", source.id)
      .execute();
    expect(owners.map((o) => o.user_id)).toEqual([alice.userId]);
    const items = await testDb.db
      .selectFrom("source_items")
      .select(["video_id", "position"])
      .where("source_id", "=", source.id)
      .orderBy("position")
      .execute();
    expect(items).toEqual([
      { video_id: "pl1", position: 0 },
      { video_id: "pl2", position: 1 },
    ]);
    const ch = await choosing(alice.userId, ["ch1"]);
    await testDb.db
      .updateTable("download_requests")
      .set({ kind: "channel" })
      .where("id", "=", ch)
      .execute();
    await post(h.app(alice), `/api/downloads/requests/${ch}/queue`, { entryIds: ["ch1"] });
    expect(
      await testDb.db
        .selectFrom("sources")
        .select("id")
        .where("source_id", "=", "PL-ch1")
        .execute(),
    ).toEqual([]);
  });
});

describe("sweepExpiredRequests", () => {
  it("deletes previews nobody finished within a day, and keeps fresh ones", async () => {
    const old = await choosing(alice.userId, ["s1"]);
    await testDb.db
      .updateTable("download_requests")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("id", "=", old)
      .execute();
    const fresh = await choosing(alice.userId, ["s2"]);
    expect(await sweepExpiredRequests(testDb.db)).toBeGreaterThanOrEqual(1);
    const left = await testDb.db
      .selectFrom("download_requests")
      .select("id")
      .where("id", "in", [old, fresh])
      .execute();
    expect(left.map((r) => r.id)).toEqual([fresh]);
  });
});
